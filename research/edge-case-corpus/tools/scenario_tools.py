'''Agent-native authoring tool surface. The agent never sees a ScenarioTemplate, a coordinate,
a tFrac or a timestamp. Every op validates preconditions and raises a structured ToolError.'''
import json, math, collections, glob, shutil, os

LANE_REF={'ego': 0, 'adjacent_left': 1, 'adjacent_right': -1}
SIDE_TFRAC={'in_lane': 0.0, 'lane_edge': -0.85, 'shoulder': -1.0}
VERB_OK=['brake_to_stop', 'change_lane', 'cross_road', 'hold_course', 'ignore_right_of_way', 'wave_traffic']

class ToolError(Exception):
    def __init__(self,code,message,**detail):
        super().__init__(message); self.payload={'code':code,'message':message,'detail':detail}

class ScenarioBuilder:
    '''find_sites -> use_site -> close_lane/place_prop/place_actor/add_interaction -> require
       -> validate -> simulate -> explain_failure'''
    pass

def _mutcd_taper_len(speed_kph, offset_m):
    """MUTCD merging taper: L = W*S^2/60 below 40 mph, L = W*S above. Solver-owned geometry."""
    s_mph=speed_kph/1.609; w_ft=offset_m*3.281
    L_ft = (w_ft*s_mph*s_mph/60.0) if s_mph<40 else (w_ft*s_mph)
    return max(15.0, L_ft/3.281)


def _find_sites(self, control=None, min_lanes=1, arms=None, maps=None, limit=40):
    """Query real map structure. Returns opaque site handles; the agent never sees road IDs."""
    feats=[]
    if control or arms:
        f={'id':'jx','kind':'junction','label':'junction','essentiality':'required',
           'atM':{'value':[0,0],'essentiality':'required'}}
        if control: f['control']={'value':list(control),'essentiality':'required','weight':3}
        if arms: f['arms']={'value':list(arms),'essentiality':'preferred','weight':2}
        feats.append(f)
    probe={'scenarioVersion':2,'meta':dict(self.doc['meta']),'params':{'declarations':[]},
      'environment':{'weather':'clear','timeOfDay':'noon'},
      'anchor':{'id':'probe','corridor':{
          'throughLanesSameDir':{'value':[min_lanes,8],'essentiality':'required'},
          'speedLimitKph':{'value':[25,80],'essentiality':'preferred','weight':2},
          'curvatureDegPer10m':{'value':[0,20],'essentiality':'required'},
          'runwayDownstreamM':{'value':[180,None],'essentiality':'required'}},
        'features':feats,'policy':{'allowMirror':True,'maxSitesPerMap':8,'diversity':'moderate','minScore':0.4}},
      'roles':[{'id':'ego','kind':'on_reference','label':'ego','actor':{'class':'car','catalogId':'vehicle.sedan'},
                'essentiality':'required','pose':{'laneOffset':0,'s':0,'tFrac':0,'headingOffsetRad':0},
                'initialSpeedKph':'clamp(0.7*lane.speedLimitKph,18,42)'}],
      'props':[],'choreography':{'clipSeconds':self.clip,'warmupSeconds':2,'interactions':[]},'invariants':[]}
    pth="/tmp/_probe_sites.template.json"; json.dump(probe,open(pth,'w'),indent=1)
    rc,o,so,se=cli("template","validate",pth)
    if rc!=0: raise ToolError('probe_invalid','site probe failed validation',issues=(o or {}).get('issues',[])[:3])
    args=["sites","match",pth,"--all-maps"] if not maps else ["sites","match",pth,"--map",maps[0]]
    rc,o,so,se=cli(*args)
    out=[]
    for m in (o or {}).get('maps',[]):
        for s in (m.get('sites') or [])[:limit]:
            out.append({'site':f"{m['mapId']}::{s['siteId']}",'map':m['mapId'],'score':s.get('score'),
                        'verdict':s.get('verdict'),'speedLimitKph':None,
                        'runwayDownstreamM':s.get('runwayDownstreamM'),'egoTurn':s.get('egoTurn')})
    if not out: raise ToolError('no_sites','no map site satisfies this query',
                                query={'control':control,'min_lanes':min_lanes,'arms':arms})
    self._sites=out; self._probe_anchor=probe['anchor']
    return out


def _use_site(self, site_handle):
    if not any(s['site']==site_handle for s in getattr(self,'_sites',[])):
        raise ToolError('unknown_site','site handle not from a find_sites() result',handle=site_handle)
    self._anchor=json.loads(json.dumps(self._probe_anchor)); self._anchor['id']=self.name
    self.doc['anchor']=self._anchor; self._site=site_handle
    self.doc['roles']=[{'id':'ego','kind':'on_reference','label':'vehicle under test',
        'actor':{'class':'car','catalogId':'vehicle.sedan'},'essentiality':'required',
        'pose':{'laneOffset':0,'s':'0 - (clamp(0.7*lane.speedLimitKph,18,42))/3.6*8','tFrac':0,'headingOffsetRad':0},
        'initialSpeedKph':'clamp(0.7*lane.speedLimitKph,18,42)'}]
    self.doc['metricSubject']='ego'
    self._log.append(('use_site',site_handle)); return {'ok':True,'site':site_handle,'ego':'seeded'}


def _close_lane(self, lane='ego', device='cone', through_junction=False, assumed_speed_kph=40):
    """Close a lane with an MUTCD-compliant device layout. The AGENT says which lane and which
    device; the SOLVER computes taper length, device spacing, and every s/tFrac."""
    self._require_anchor()
    if lane not in LANE_REF: raise ToolError('bad_lane',f'lane must be one of {list(LANE_REF)}',got=lane)
    dev={'cone':'construction.traffic_cone','drum':'construction.channelizer_drum',
         'barricade':'construction.barricade_type3','barrier':'construction.jersey_barrier_run'}.get(device)
    if dev is None: raise ToolError('bad_device','device must be cone|drum|barricade|barrier',got=device)
    offset=3.2
    L=_mutcd_taper_len(assumed_speed_kph,offset)
    spacing=max(6.0, assumed_speed_kph/3.281/2)
    n=max(4,int(L/spacing))
    s0=-(L+45.0) if through_junction else -(L+20.0)
    self.doc['props'].append({'id':'wz-taper','catalogId':dev,'label':f'MUTCD merging taper ({device}) L={L:.0f} m',
        'essentiality':'required','pose':{'laneOffset':LANE_REF[lane],'s':round(s0,2),'tFrac':-0.95,'headingOffsetRad':0},
        'headingOffsetRad':0,'scale':1,'repeat':{'count':n,'spacingM':round(spacing,2),'tFracStep':round(1.9/n,3)}})
    self.doc['props'].append({'id':'wz-board','catalogId':'construction.arrow_board','label':'arrow board at taper head',
        'essentiality':'required','pose':{'laneOffset':LANE_REF[lane],'s':round(s0-6,2),'tFrac':-0.9,'headingOffsetRad':0},
        'headingOffsetRad':0,'scale':1})
    self.doc['props'].append({'id':'wz-advance','catalogId':'construction.sign_road_work','label':'advance warning sign',
        'essentiality':'required','pose':{'laneOffset':LANE_REF[lane],'s':round(s0-60,2),'tFrac':-1.0,'headingOffsetRad':0},
        'headingOffsetRad':0,'scale':1})
    self._zones={'advance_warning':s0-60,'taper':s0,'buffer':s0+L,'activity':s0+L+15,
                 'termination':s0+L+15+40,'junction':0.0}
    self._closed_lane=lane
    self._log.append(('close_lane',lane,device,round(L,1),n))
    return {'ok':True,'device':dev,'taperLengthM':round(L,1),'devices':n,'deviceSpacingM':round(spacing,2),
            'zones':{k:round(v,1) for k,v in self._zones.items()},
            'note':'taper length and spacing solved from MUTCD; agent supplied no geometry'}


def _place_prop(self, catalog_id, zone, lane='ego', side='in_lane', count=1, spacing_m=None, heading_deg=0):
    self._require_anchor()
    if catalog_id not in CATALOG:
        near=[k for k in CATALOG if catalog_id.split('.')[-1].lower() in k.lower()][:5]
        raise ToolError('unknown_catalog_id','no such prop in the catalog — assets are resolved at author time',
                        got=catalog_id, did_you_mean=near or sorted(CATALOG)[:5])
    if not hasattr(self,'_zones'): self._zones={'junction':0.0,'approach':-60.0,'departure':40.0}
    if zone not in self._zones:
        raise ToolError('unknown_zone','zone must be one of the layout zones',got=zone,available=sorted(self._zones))
    if side not in SIDE_TFRAC:
        raise ToolError('bad_side','side must be in_lane|lane_edge|shoulder (verge/sidewalk is NOT representable: tFrac>=-1)',
                        got=side, available=sorted(SIDE_TFRAC))
    pid=f"p{len(self.doc['props'])}-{catalog_id.split('.')[-1]}"
    p={'id':pid,'catalogId':catalog_id,'label':f'{CATALOG[catalog_id]["label"]} @ {zone}','essentiality':'required',
       'pose':{'laneOffset':LANE_REF[lane],'s':round(self._zones[zone],2),'tFrac':SIDE_TFRAC[side],
               'headingOffsetRad':round(math.radians(heading_deg),4)},'headingOffsetRad':0,'scale':1}
    if count>1: p['repeat']={'count':count,'spacingM':spacing_m or 5.0,'tFracStep':0}
    self.doc['props'].append(p); self._log.append(('place_prop',catalog_id,zone,count))
    return {'ok':True,'prop':pid,'resolvedDims':CATALOG[catalog_id]['dims'],
            'occlusion':[t for t in CATALOG[catalog_id]['tags'] if t.startswith('occlusion')]}


def _place_actor(self, role, catalog_id, approach='ego_lane', behaviour='through'):
    self._require_anchor()
    if catalog_id not in CATALOG:
        raise ToolError('unknown_catalog_id','no such actor in the catalog',got=catalog_id,
                        did_you_mean=[k for k in CATALOG if catalog_id.split('.')[-1].lower() in k.lower()][:5])
    cls=CATALOG[catalog_id]['class']
    kind={'vehicle':'car','pedestrian':'pedestrian','construction':'pedestrian'}.get(cls,'car')
    if catalog_id=='vehicle.bicycle': kind='bicycle'
    if role in [r['id'] for r in self.doc['roles']]:
        raise ToolError('duplicate_role','role already exists',role=role)
    r={'id':role,'kind':'conflicting_gate' if approach=='conflicting' else 'on_reference',
       'label':f'{role} ({CATALOG[catalog_id]["label"]})',
       'actor':{'class':kind,'catalogId':catalog_id},'essentiality':'required'}
    if approach=='conflicting':
        r.update({'feature':'jx','from':'from_left','turn':'straight',
                  'arriveAtConflict':{'relativeTo':'ego','deltaT':'-param.arrivalTtc'},
                  'requiredUpstreamRunwayM':60,'initialSpeedKph':'clamp(0.85*lane.speedLimitKph,20,55)'})
        self._add_param('arrivalTtc',[0.6,2.4],1.4,'s')
    else:
        r.update({'pose':{'laneOffset':0,'s':-12,'tFrac':-1,'headingOffsetRad':0},
                  'initialSpeedKph':'param.vruSpeedKph' if kind=='pedestrian' else 'clamp(0.8*lane.speedLimitKph,18,45)'})
        if kind=='pedestrian': self._add_param('vruSpeedKph',[3,9],5.0,'kph')
    self.doc['roles'].append(r); self._log.append(('place_actor',role,catalog_id,approach))
    return {'ok':True,'role':role,'class':kind,'resolvedDims':CATALOG[catalog_id]['dims']}


def _add_param(self,pid,rng,dflt,unit=''):
    if any(d['id']==pid for d in self.doc['params']['declarations']): return
    self.doc['params']['declarations'].append({'id':pid,'type':'continuous','description':pid,'unit':unit,
        'tier':1,'range':list(rng),'default':dflt,'distribution':'uniform'})


def _add_interaction(self, actor, does, when='scenario_start', relative_to=None):
    self._require_anchor()
    if actor not in [r['id'] for r in self.doc['roles']]:
        raise ToolError('unknown_actor','no such actor; call place_actor first',got=actor,
                        available=[r['id'] for r in self.doc['roles']])
    if does not in VERB_OK:
        raise ToolError('unknown_action','unsupported action',got=does,available=sorted(VERB_OK))
    n=len(self.doc['choreography']['interactions']); iid=f"i{n}-{actor}-{does}"
    trig={'kind':'at','t':0}
    if when=='on_approach': trig={'kind':'at','t':3}
    elif when=='after' and relative_to: trig={'kind':'after','of':relative_to,'event':'start','delayS':'param.reactionDelayS'}; self._add_param('reactionDelayS',[0.6,1.6],1.0,'s')
    elif when=='at_conflict':
        trig={'kind':'arrival','of':actor,'at':{'pose':{'laneOffset':0,'s':0,'tFrac':0,'headingOffsetRad':0}},
              'syncWith':'ego','ttc':'param.arrivalTtc'}; self._add_param('arrivalTtc',[0.6,2.4],1.4,'s')
    if does=='brake_to_stop':
        it={'id':iid,'actor':actor,'verb':'speed','trigger':trig,'target':{'mode':'stop'},
            'dynamics':{'shape':'linear','constraint':'rate','value':7.0}}
    elif does=='ignore_right_of_way':
        it={'id':iid,'actor':actor,'verb':'set','trigger':{'kind':'at','t':0},
            'target':{'key':'rules.yieldToVehicles','value':False}}
    elif does=='hold_course':
        it={'id':iid,'actor':actor,'verb':'set','trigger':{'kind':'at','t':0},
            'target':{'key':'rules.collisionAvoidance','value':False}}
    elif does=='change_lane':
        it={'id':iid,'actor':actor,'verb':'changeLane','trigger':trig,'target':{'mode':'toRole','role':'ego'},
            'dynamics':{'shape':'sinusoidal','constraint':'rate','value':1.4}}
    elif does=='cross_road':
        it={'id':iid,'actor':actor,'verb':'route','trigger':{'kind':'at','t':0},
            'target':{'mode':'polyline','points':[
              {'laneOffset':0,'s':-12,'tFrac':-1,'headingOffsetRad':0},
              {'laneOffset':0,'s':0,'tFrac':-1,'headingOffsetRad':0},
              {'laneOffset':0,'s':3,'tFrac':0.1,'headingOffsetRad':0},
              {'laneOffset':0,'s':6,'tFrac':1,'headingOffsetRad':0}]}}
    else:
        it={'id':iid,'actor':actor,'verb':'set','trigger':{'kind':'at','t':0},
            'target':{'key':'pose.paddle','value':'stop'}}
    self.doc['choreography']['interactions'].append(it); self._log.append(('add_interaction',actor,does,when))
    return {'ok':True,'interaction':iid}


def _require(self, metric, between, band=None, outcome=None):
    m={'ttc':'ttc','pet':'pet','path_ttc':'path_ttc'}.get(metric)
    if metric=='no_collision':
        self._rubric_extra=getattr(self,'_rubric_extra',[])+[{'id':f'R-nocoll','kind':'collision','required':True,
            'pair':list(between),'maxCount':0}]; return {'ok':True}
    if m is None: raise ToolError('unknown_metric','metric must be ttc|pet|path_ttc|no_collision',got=metric)
    self.doc['invariants'].append({'id':f'criticality','kind':m,'of':between[0],'to':between[1],
        'range':list(band),'window':[3,self.clip-3],'essentiality':'required'})
    self._rubric_extra=getattr(self,'_rubric_extra',[])+[{'id':'R-criticality','kind':'criticality','required':True,
        'metric':m,'pair':list(between),'minS':band[0],'maxS':band[1]}]
    return {'ok':True}


def _write(self):
    p=f"/tmp/tool-{self.name}.template.json"; json.dump(self.doc,open(p,'w'),indent=1); return p


def _validate(self):
    p=self._write(); rc,o,so,se=cli("template","validate",p)
    if rc!=0:
        raise ToolError('invalid_scene','the scene does not satisfy the authoring contract',
                        issues=[{'path':i.get('path'),'reason':i['message'][:140]} for i in (o or {}).get('issues',[])[:6]])
    return {'ok':True,'warnings':(o or {}).get('counts',{}).get('warning',0)}


def _simulate(self, draws=4, all_maps=True):
    """Run the real engine. Returns metrics read from the RAW TRACE, never a summary field."""
    self._validate(); p=self._write()
    out=f"/tmp/toolrun-{self.name}"; shutil.rmtree(out,ignore_errors=True)
    args=["batch",p,"--all-maps" if all_maps else "--map",("" if all_maps else self._site.split('::')[0]),
          "--draws",str(draws),"--out",out]
    args=[a for a in args if a!=""]
    rc,o,so,se=cli(*args,timeout=2400)
    if not o: raise ToolError('simulate_failed','batch produced no result',stderr=se[-300:])
    res=[]
    for f in sorted(glob.glob(f"{out}/*/*/draw-*.trace.json.gz")):
        tr=load_trace(f); mm=tr['metrics']
        res.append({'trace':f,'map':f.split('/')[3],'site':f.split('/')[4],
            'minTTC':(mm.get('minTTC') or {}).get('value'),
            'minPathTTC':(mm.get('minPathTTC') or {}).get('value'),
            'collisions':len(mm.get('collisions',[])),
            'neverFired':list(mm.get('triggerNeverFired',[])),
            'events':collections.Counter(e['kind'] for e in tr['events'])})
    self._last={'summary':o,'cells':res,'outdir':out}
    return {'cells':len(res),'maps':sorted({r['map'] for r in res}),'sites':len({(r['map'],r['site']) for r in res}),
            'bands':o.get('criticality',{}).get('bands'),
            'cellsWithContact':sum(1 for r in res if r['collisions']>0),
            'criticalCells':o.get('criticality',{}).get('accepted')}


def _explain_failure(self, limit=6):
    if not hasattr(self,'_last'): raise ToolError('nothing_to_explain','call simulate() first')
    codes=collections.Counter(); reasons=collections.Counter(); ev=collections.Counter()
    for f in glob.glob(f"{self._last['outdir']}/*/*/draw-*.result.json"):
        x=json.load(open(f))
        for fd in x.get('findings',[]): codes[fd['code']]+=1; reasons[(fd['code'],fd['reason'][:70])]+=1
        if x.get('status')=='error': codes['error:'+str(x.get('error',{}).get('code'))]+=1
    for r in self._last['cells']:
        for k,v in r['events'].items(): ev[k]+=v
    return {'findingCodes':dict(codes.most_common()),
            'topReasons':[{'code':k[0],'reason':k[1],'n':v} for k,v in reasons.most_common(limit)],
            'traceEvents':dict(ev.most_common()),
            'hint':('road_departure_prevented or collisions against props usually mean the ego route still '
                    'uses the closed lane — the closure is scenery until the ego is routed around it.')}


ScenarioBuilder.find_sites=_find_sites; ScenarioBuilder.use_site=_use_site
ScenarioBuilder.close_lane=_close_lane; ScenarioBuilder.place_prop=_place_prop
ScenarioBuilder.place_actor=_place_actor; ScenarioBuilder._add_param=_add_param
ScenarioBuilder.add_interaction=_add_interaction; ScenarioBuilder.require=_require
ScenarioBuilder._write=_write; ScenarioBuilder.validate=_validate
ScenarioBuilder.simulate=_simulate; ScenarioBuilder.explain_failure=_explain_failure