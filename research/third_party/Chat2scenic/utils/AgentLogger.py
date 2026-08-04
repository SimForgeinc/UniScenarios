import os
import json
import logging
import random
import re
from datetime import datetime
from typing import Optional, Dict, Any
from pathlib import Path


class AgentLogger:
    def __init__(self, generation_id: Optional[str] = None, user_query: Optional[str] = None, base_dir: Optional[str] = None):
        if generation_id:
            self.generation_id = generation_id
        else:
            date_str = datetime.now().strftime("%Y%m%d")
            random_num = random.randint(1000, 9999)
            if user_query:
                short_name = self._create_short_name(user_query)
                self.generation_id = f"{date_str}_{random_num}_{short_name}"
            else:
                self.generation_id = f"{date_str}_{random_num}_unknown"
        
        # Use provided base_dir or default to "results"
        root_dir = Path(base_dir) if base_dir else Path("results")
        self.results_dir = root_dir / self.generation_id
        self.results_dir.mkdir(parents=True, exist_ok=True)
        
        self.invocation_counter = {}
        
        self.global_counter = 0
        
        self.session_log_file = self.results_dir / "session_log.jsonl"
        
        self._write_session_metadata(user_query)
        
        logging.info(f"📁 AgentLogger initialized. Logs will be saved to: {self.results_dir}")
    
    def _create_short_name(self, user_query: str, max_words: int = 5) -> str:
        clean_query = re.sub(r'[^\w\s-]', '', user_query.lower())
        
        words = clean_query.split()[:max_words]
        
        short_name = '_'.join(words)
        
        if len(short_name) > 50:
            short_name = short_name[:50]
        
        return short_name if short_name else "scenario"
    
    def _write_session_metadata(self, user_query: Optional[str] = None):
        metadata = {
            "generation_id": self.generation_id,
            "user_query": user_query,
            "start_time": datetime.now().isoformat(),
            "results_directory": str(self.results_dir)
        }
        
        metadata_file = self.results_dir / "generation_metadata.json"
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2)
    
    def _format_agent_name(self, agent_name: str, metadata: Optional[Dict[str, Any]] = None) -> str:
        if agent_name == "ComponentScoringAgent" and metadata:
            component_type = metadata.get("component_type", "")
            if component_type:
                component_type = component_type.replace("_", "")
                return f"Scoring{component_type}Agent"
        return agent_name
    
    def log_agent_interaction(
        self,
        agent_name: str,
        system_prompt: Optional[str] = None,
        user_prompt: Optional[str] = None,
        full_prompt: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        response: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        formatted_agent_name = self._format_agent_name(agent_name, metadata)
        self.global_counter += 1
        if formatted_agent_name not in self.invocation_counter:
            self.invocation_counter[formatted_agent_name] = 0
        self.invocation_counter[formatted_agent_name] += 1
        timestamp = datetime.now().isoformat()
        log_entry = {
            "agent_name": formatted_agent_name,
            "timestamp": timestamp,
            "full_prompt": full_prompt,
            "response": response
        }
        
        if "Scoring" in formatted_agent_name and response and metadata:
            try:
                response_json = json.loads(response.strip().replace("```json", "").replace("```", "").strip())
                if response_json.get("is_satisfied") and metadata.get("component_code"):
                    log_entry["component_code"] = metadata["component_code"]
            except (json.JSONDecodeError, AttributeError):
                pass
        
        if formatted_agent_name == "CodeAdapterAgent" and metadata and metadata.get("retrieved_code"):
            log_entry["code_before_adaptation"] = metadata["retrieved_code"]
        
        with open(self.session_log_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + '\n')
        
        agent_log_file = self.results_dir / f"{self.global_counter}.{formatted_agent_name}.txt"
        self._write_detailed_log(agent_log_file, log_entry)
        
        logging.debug(f"📝 Logged {formatted_agent_name} as #{self.global_counter}")
    
    def _write_detailed_log(self, file_path: Path, log_entry: Dict[str, Any]):
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write(f"AGENT: {log_entry['agent_name']}\n")
            f.write(f"TIMESTAMP: {log_entry['timestamp']}\n")
            f.write("=" * 80 + "\n\n")
            
            if log_entry.get('code_before_adaptation'):
                f.write("-" * 80 + "\n")
                f.write("CODE BEFORE ADAPTATION\n")
                f.write("-" * 80 + "\n")
                f.write(log_entry['code_before_adaptation'])
                f.write("\n\n")
            
            f.write("-" * 80 + "\n")
            f.write("RESPONSE\n")
            f.write("-" * 80 + "\n")
            if log_entry.get('response'):
                f.write(log_entry['response'])
            else:
                f.write("(No response)")
            f.write("\n\n")
            
            f.write("-" * 80 + "\n")
            f.write("PROMPT\n")
            f.write("-" * 80 + "\n")
            if log_entry.get('full_prompt'):
                f.write(log_entry['full_prompt'])
            else:
                f.write("(No prompt)")
            f.write("\n\n")
            
            if log_entry.get('component_code'):
                f.write("-" * 80 + "\n")
                f.write("COMPONENT CODE (SATISFIED)\n")
                f.write("-" * 80 + "\n")
                f.write(log_entry['component_code'])
                f.write("\n\n")
            
            f.write("=" * 80 + "\n")
            f.write("END OF LOG\n")
            f.write("=" * 80 + "\n")
    
    def log_workflow_event(self, event_type: str, event_data: Dict[str, Any]):
        timestamp = datetime.now().isoformat()
        
        log_entry = {
            "event_type": event_type,
            "timestamp": timestamp,
            "event_data": event_data
        }
        
        workflow_log_file = self.results_dir / "workflow_events.jsonl"
        with open(workflow_log_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + '\n')
    
    def get_summary(self) -> Dict[str, Any]:
        return {
            "generation_id": self.generation_id,
            "results_directory": str(self.results_dir),
            "agent_invocations": dict(self.invocation_counter),
            "total_invocations": sum(self.invocation_counter.values())
        }
    
    def write_summary(self):
        summary = self.get_summary()
        summary["end_time"] = datetime.now().isoformat()
        
        summary_file = self.results_dir / "generation_summary.json"
        with open(summary_file, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2)
        
        logging.info(f"📊 Generation summary written to: {summary_file}")


_global_agent_logger: Optional[AgentLogger] = None


def get_agent_logger() -> Optional[AgentLogger]:
    return _global_agent_logger


def initialize_agent_logger(session_id: Optional[str] = None, user_query: Optional[str] = None) -> AgentLogger:
    global _global_agent_logger
    _global_agent_logger = AgentLogger(session_id, user_query)
    return _global_agent_logger


def reset_agent_logger():
    global _global_agent_logger
    if _global_agent_logger:
        _global_agent_logger.write_summary()
    _global_agent_logger = None

