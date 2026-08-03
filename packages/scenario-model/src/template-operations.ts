/** Serializable edits supported by {@link TemplateDocument}. */

import { ScenarioOperationError } from './errors.js';
import type { Interaction } from './schema/v2/interactions.js';
import type { RoleBinding } from './schema/v2/roles.js';
import type { ScenarioTemplateV2, TemplateMeta } from './schema/v2/template.js';
import type { MapRef } from './schema/v1.js';

/** Metadata fields an editor may change. Timestamps remain document-managed. */
export type TemplateMetaPatch = Partial<
  Pick<
    TemplateMeta,
    'name' | 'description' | 'appVersion' | 'archetype' | 'tags' | 'author' | 'negativeControl'
  >
>;

export type TemplateOp =
  | { type: 'setTemplateMeta'; patch: TemplateMetaPatch }
  | { type: 'setSourceMap'; sourceMap: MapRef | null }
  | { type: 'addRole'; role: RoleBinding; index?: number }
  | { type: 'replaceRole'; id: string; role: RoleBinding }
  | { type: 'removeRole'; id: string }
  | { type: 'moveRole'; id: string; toIndex: number }
  | { type: 'addInteraction'; interaction: Interaction; index?: number }
  | { type: 'replaceInteraction'; id: string; interaction: Interaction }
  | { type: 'removeInteraction'; id: string }
  | { type: 'removeProp'; id: string }
  | { type: 'removeInvariant'; id: string }
  | { type: 'removeVariant'; id: string }
  | { type: 'setMetricSubject'; roleId: string | null }
  | { type: 'setClip'; clipSeconds?: number; warmupSeconds?: number }
  | { type: 'setTemplateExtension'; key: string; value?: unknown };

export function describeTemplateOp(op: TemplateOp): string {
  switch (op.type) {
    case 'setTemplateMeta': return 'Edit scenario info';
    case 'setSourceMap': return 'Change source map';
    case 'addRole': return 'Add actor';
    case 'replaceRole': return 'Edit actor';
    case 'removeRole': return 'Delete actor';
    case 'moveRole': return 'Reorder actor';
    case 'addInteraction': return 'Add interaction';
    case 'replaceInteraction': return 'Edit interaction';
    case 'removeInteraction': return 'Delete interaction';
    case 'removeProp': return 'Delete prop';
    case 'removeInvariant': return 'Delete rule';
    case 'removeVariant': return 'Delete variant';
    case 'setMetricSubject': return 'Set metric subject';
    case 'setClip': return 'Edit scenario duration';
    case 'setTemplateExtension': return 'Edit extension';
  }
}

function indexOf(items: readonly { id: string }[], id: string, kind: string): number {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new ScenarioOperationError(`no ${kind} with id "${id}"`);
  return index;
}

function insertionIndex(index: number | undefined, length: number): number {
  const at = index ?? length;
  if (at < 0 || at > length) throw new ScenarioOperationError(`index ${at} is out of range`);
  return at;
}

/** Apply one operation to an Immer draft. Schema validation happens after this function. */
export function applyTemplateOp(draft: ScenarioTemplateV2, op: TemplateOp): void {
  switch (op.type) {
    case 'setTemplateMeta':
      Object.assign(draft.meta, op.patch);
      return;
    case 'setSourceMap':
      if (op.sourceMap === null) delete draft.sourceMap;
      else draft.sourceMap = { ...op.sourceMap };
      return;
    case 'addRole': {
      if (draft.roles.some((role) => role.id === op.role.id)) {
        throw new ScenarioOperationError(`role id "${op.role.id}" already exists`);
      }
      draft.roles.splice(insertionIndex(op.index, draft.roles.length), 0, op.role);
      return;
    }
    case 'replaceRole': {
      const at = indexOf(draft.roles, op.id, 'role');
      if (op.role.id !== op.id && draft.roles.some((role) => role.id === op.role.id)) {
        throw new ScenarioOperationError(`role id "${op.role.id}" already exists`);
      }
      draft.roles[at] = op.role;
      return;
    }
    case 'removeRole':
      draft.roles.splice(indexOf(draft.roles, op.id, 'role'), 1);
      return;
    case 'moveRole': {
      const from = indexOf(draft.roles, op.id, 'role');
      if (op.toIndex < 0 || op.toIndex >= draft.roles.length) {
        throw new ScenarioOperationError(`index ${op.toIndex} is out of range`);
      }
      const [role] = draft.roles.splice(from, 1);
      draft.roles.splice(op.toIndex, 0, role as RoleBinding);
      return;
    }
    case 'addInteraction': {
      const items = draft.choreography.interactions;
      if (items.some((interaction) => interaction.id === op.interaction.id)) {
        throw new ScenarioOperationError(`interaction id "${op.interaction.id}" already exists`);
      }
      items.splice(insertionIndex(op.index, items.length), 0, op.interaction);
      return;
    }
    case 'replaceInteraction': {
      const items = draft.choreography.interactions;
      const at = indexOf(items, op.id, 'interaction');
      if (op.interaction.id !== op.id && items.some((item) => item.id === op.interaction.id)) {
        throw new ScenarioOperationError(`interaction id "${op.interaction.id}" already exists`);
      }
      items[at] = op.interaction;
      return;
    }
    case 'removeInteraction':
      draft.choreography.interactions.splice(
        indexOf(draft.choreography.interactions, op.id, 'interaction'),
        1,
      );
      return;
    case 'removeProp':
      draft.props.splice(indexOf(draft.props, op.id, 'prop'), 1);
      return;
    case 'removeInvariant':
      draft.invariants.splice(indexOf(draft.invariants, op.id, 'invariant'), 1);
      return;
    case 'removeVariant':
      draft.variants.splice(indexOf(draft.variants, op.id, 'variant'), 1);
      return;
    case 'setMetricSubject':
      if (op.roleId === null) delete draft.metricSubject;
      else draft.metricSubject = op.roleId;
      return;
    case 'setClip':
      if (op.clipSeconds !== undefined) draft.choreography.clipSeconds = op.clipSeconds;
      if (op.warmupSeconds !== undefined) draft.choreography.warmupSeconds = op.warmupSeconds;
      return;
    case 'setTemplateExtension':
      if (op.value === undefined) {
        if (draft.extensions) {
          delete draft.extensions[op.key];
          if (Object.keys(draft.extensions).length === 0) delete draft.extensions;
        }
      } else {
        if (!draft.extensions) draft.extensions = {};
        draft.extensions[op.key] = op.value;
      }
      return;
  }
}
