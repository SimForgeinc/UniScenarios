import json

def parse_json_from_text(text: str) -> dict:
    text = text.strip()
    
    if text.startswith('{'):
        try:
            json_data = json.loads(text)
            return json_data
        except json.JSONDecodeError as e:
            print(f"[DEBUG] Failed to parse as direct JSON: {e}")
    
    if '```json' in text or '```' in text:
        try:
            start_marker = '```json'
            if start_marker in text:
                start = text.find(start_marker) + len(start_marker)
            else:
                start = text.find('```') + 3
            
            end = text.find('```', start)
            if end == -1:
                end = len(text)
            
            json_str = text[start:end].strip()
            json_data = json.loads(json_str)
            return json_data
        except (json.JSONDecodeError, ValueError) as e:
            print(f"[DEBUG] Failed to extract JSON from code block: {e}")
  
    try:
        start = text.find('{')
        end = text.rfind('}') + 1
        if start != -1 and end > start:
            json_str = text[start:end]
            json_data = json.loads(json_str)
            return json_data
    except (json.JSONDecodeError, ValueError) as e:
        print(f"[DEBUG] Failed to extract JSON from text: {e}")
    
    return {}
