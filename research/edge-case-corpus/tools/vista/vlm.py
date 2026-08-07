"""The only permitted model: gpt-5.6-luna, reasoning effort medium. Text and vision."""
import os, json, base64, time
import httpx

MODEL = 'gpt-5.6-luna'
EFFORT = 'medium'
URL = 'https://api.openai.com/v1/responses'


def _content(prompt, images):
    c = [{'type': 'input_text', 'text': prompt}]
    for p in images or []:
        b64 = base64.b64encode(open(p, 'rb').read()).decode()
        c.append({'type': 'input_image', 'image_url': f'data:image/png;base64,{b64}'})
    return c


def ask(prompt, images=None, max_tokens=12000, retries=4, timeout=300):
    """One call. Returns the concatenated output text. Raises after `retries` failures."""
    key = os.environ['OPENAI_API_KEY']
    body = {'model': MODEL, 'reasoning': {'effort': EFFORT}, 'max_output_tokens': max_tokens,
            'input': [{'role': 'user', 'content': _content(prompt, images)}]}
    last = None
    for i in range(retries):
        try:
            r = httpx.post(URL, headers={'Authorization': f'Bearer {key}'}, json=body, timeout=timeout)
            if r.status_code != 200:
                last = f'HTTP {r.status_code}: {r.text[:300]}'
                time.sleep(2 + 4 * i)
                continue
            d = r.json()
            out = []
            for item in d.get('output', []):
                for c in item.get('content', []) or []:
                    if c.get('type') == 'output_text':
                        out.append(c['text'])
            txt = '\n'.join(out).strip()
            if txt:
                return txt
            last = f"empty output (status={d.get('status')}, incomplete={d.get('incomplete_details')})"
        except Exception as e:                                    # noqa: BLE001
            last = f'{type(e).__name__}: {e}'
        time.sleep(2 + 4 * i)
    raise RuntimeError(f'model call failed after {retries} tries: {last}')


def ask_json(prompt, images=None, **kw):
    """Ask for JSON and parse it, tolerating a stray code fence."""
    txt = ask(prompt, images, **kw)
    return parse_json(txt), txt


def parse_json(txt):
    s = txt.strip()
    if s.startswith('```'):
        s = s.split('\n', 1)[1] if '\n' in s else s
        if s.rstrip().endswith('```'):
            s = s.rstrip()[:-3]
    s = s.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        a, b = s.find('{'), s.rfind('}')
        if a >= 0 and b > a:
            return json.loads(s[a:b + 1])
        raise
