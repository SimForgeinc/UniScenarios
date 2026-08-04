<h1 align="center">[IROS 2026] Chat2Scenic: An Iterative RAG-Based Framework for Scenario Generation in Autonomous Driving</h1>

<p align="center">
   <a href="https://arxiv.org/abs/2607.14387">📝 arXiv</a>
   &nbsp;•&nbsp;
   <a href="https://anonymous-research-paper.github.io/Chat2Scenic/">🌐 Homepage</a>
   &nbsp;•&nbsp;
   <a href="https://huggingface.co/datasets/chat2scenic/Chat2Scenic">🤗 Dataset</a>
   &nbsp;•&nbsp;
   <a href="#citation">📄 Citation</a>
</p>

<p align="center">
   <a href="https://arxiv.org/abs/2607.14387"><img alt="arXiv" src="https://img.shields.io/badge/arXiv-2607.14387-b31b1b.svg"></a>
   <img alt="IROS 2026" src="https://img.shields.io/badge/IROS%202026-Accepted-success">
   <img alt="Python" src="https://img.shields.io/badge/Python-3.10-blue">
   <img alt="RAG" src="https://img.shields.io/badge/LangChain-RAG-purple">
   <img alt="Agent Workflow" src="https://img.shields.io/badge/LangGraph-Agent%20Workflow-orange">
   <img alt="Vector DB" src="https://img.shields.io/badge/VectorDB-Milvus-green">
   <img alt="UI" src="https://img.shields.io/badge/UI-Gradio-yellow">
   <a href="LICENSE"><img alt="License: CC BY-NC 4.0" src="https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey"></a>
</p>

<p align="center">
   <b>🎉 Accepted at IROS 2026 — IEEE/RSJ International Conference on Intelligent Robots and Systems.</b>
</p>

> Turn a natural-language regulatory description into an executable CARLA scenario — through an iterative, RAG-grounded chatbot that writes Scenic DSL for you.

## Overview

Validating autonomous driving systems requires diverse, regulation-compliant test scenarios. In simulation-based testing, scenarios are defined as executable DSL scripts that parametrically specify road topology, actor behaviors, and environmental conditions for simulators such as CARLA. Yet automatically generating such scripts from complex regulatory descriptions remains an open challenge, and existing approaches face fundamental trade-offs: retrieval-assemble methods achieve reasonable compilation rates but lack scalability, while retrieval-based full-script generation suffers from low compilation success.

We present **Chat2Scenic**, the first iterative retrieval-augmented framework to automatically translate natural language regulatory descriptions into executable Scenic DSL scripts. Chat2Scenic provides a chatbot interface for interactive scenario refinement and integrates RAG to ground scenario generation in regulatory knowledge and DSL syntax. We further propose an **open benchmark comprising 123 scenarios** drawn from NHTSA, United Nations Vehicle Regulations, and the CARLA Leaderboard. Chat2Scenic achieves a **Compilation Success Rate of 76.42%** and a **Framework Accuracy of 58.17%**, outperforming retrieval-assemble (30% CSR, 11.03% FA) and retrieval full-script generation (16.26% CSR, 10.08% FA).

## Framework

<p align="center">
   <img src="assets/framework.png" alt="Chat2Scenic framework architecture" width="90%" />
</p>

Chat2Scenic decomposes scenario generation into three cooperating modules and renders the result in the CARLA simulator:

- **Interactive Module** — The user describes a scenario in natural language. An **Interpreter** agent parses the description into a logical scenario structure (Ego, Objects/Adversarials, Restrictions, Spatial Relation) and iteratively refines it with the user through the chatbot until confirmed.
- **Generation Module** — Once confirmed, a **Global Configuration Generator** (Setting Detector + Header Generator) infers the global configuration (weather, vehicle model, map), and a **Components Generator** produces the Scenic script component-by-component in a fixed order: *Spatial Relation → Ego → Object → Restriction*. Each component conditions on the previously generated ones.
- **RAG Module** — A **Dual Retriever** grounds generation in external knowledge: a *code* retriever embeds the query and fetches Top-3 Scenic DSL snippets from a vector database, while a *doc* retriever performs keyword search and reranking over regulatory documents and reference scenarios.
- **Simulation** — The assembled Scenic script is executed in CARLA and rendered from three viewpoints: Bird's-Eye View (BEV), First-Person View (FPV), and Third-Person View (TPV).

## System Demonstrations

### Demo 1 — Chatbot & Scenic Code Generation

The interactive chatbot interprets a natural-language request, negotiates the logical scenario structure with the user, and generates the corresponding Scenic DSL script component-by-component, reporting the source of each component and the end-to-end generation time.

<p align="center">
   <img src="assets/demo_chatbot.gif" alt="Chatbot & Scenic code generation demo" width="80%" />
</p>

### Demo 2 — Human Evaluation GUI

To assess **Scenario Alignment**, we built a dedicated annotation tool that presents evaluators with the original benchmark description alongside the CARLA simulation video (BEV, FPV, TPV). Annotators rate five alignment layers — Road Layout (RL), Traffic Infrastructure (TI), Temporal Modifications (TM), Dynamic Objects (DO), and Environment (EN) — each on a binary pass/fail basis. The aggregated scores feed directly into the **Scenario Quality (SQ)** and **Framework Accuracy (FA)** metrics.

<p align="center">
   <img src="assets/demo_evaluation_gui.gif" alt="Human evaluation GUI demo" width="80%" />
</p>

## Qualitative Examples

Generated scenarios rendered in CARLA, shown from all three camera views — BEV (Bird's-Eye), FPV (First-Person), and TPV (Third-Person).

**Description:** *"The ego-vehicle is performing an unprotected left turn at an intersection, yielding to oncoming traffic."* (CARLA Leaderboard — Scenario 002)

<p align="center">
   <img src="assets/CARLA_Leaderboard__scenario_002__Town10HD_Opt__TPV.gif" alt="TPV" width="32%" />
   <img src="assets/CARLA_Leaderboard__scenario_002__Town10HD_Opt__FPV.gif" alt="FPV" width="32%" />
   <img src="assets/CARLA_Leaderboard__scenario_002__Town10HD_Opt__BEV.gif" alt="BEV" width="32%" />
</p>

Additional qualitative examples across benchmark categories are available in the interactive carousel on the [project homepage](https://anonymous-research-paper.github.io/Chat2Scenic/):

| Category | Example scenario |
| --- | --- |
| CARLA Leaderboard | Unprotected left/right turns and unsignalized-intersection negotiation |
| NHTSA Crash | Pedestrian crossing, red-light running, and rear-end collisions |
| NHTSA PreCrash | Loss-of-control on wet roads and turning conflicts at intersections |
| UN R152 | Car-following with a lead vehicle turning at a corner |
| UN R171 | Lane-change conflicts, cut-ins, and pedestrian/cyclist emergency braking |

## Results

Chat2Scenic substantially outperforms both retrieval baselines on the 123-scenario benchmark:

| Method | Compilation Success Rate (CSR) | Framework Accuracy (FA) |
| --- | :---: | :---: |
| Retrieval-assemble | 30.00% | 11.03% |
| Retrieval full-script generation | 16.26% | 10.08% |
| **Chat2Scenic (ours)** | **76.42%** | **58.17%** |

See the [project homepage](https://anonymous-research-paper.github.io/Chat2Scenic/) for the full quantitative results and ablation study.

## Benchmark

We release an open benchmark of **123 scenarios** drawn from three regulatory sources, located under `Benchmark/`:

- **NHTSA** — `NHTSA_Crash.txt`, `NHTSA_PreCrash.txt`
- **United Nations Vehicle Regulations** — `UN_R152.txt`, `UN_R157.txt`, `UN_R171.txt`
- **CARLA Leaderboard** — `CARLA_Leaderboard.txt`

## Database setup (Milvus)

Chat2Scenic uses Milvus for document and scenario embeddings and retrieval.

1. Make sure you have a Milvus standalone container running.
   - Installation guide: [Milvus Standalone (Docker Compose)](https://milvus.io/docs/v2.3.x/install_standalone-docker-compose.md)
2. Restore the provided Milvus volume snapshot:
   - Download [volumes-release.zip](https://huggingface.co/datasets/chat2scenic/Chat2Scenic/resolve/main/volumes-release.zip)
   - Extract it and replace the existing Milvus volume directory.
   - If you already have Milvus data, back up your current volume first.
3. Restart the Milvus container.

## Quickstart

### 1) Python environment

```bash
conda create --name chat2scenic python=3.10
conda activate chat2scenic
pip install -r requirements.txt
```

### 2) Configure `.env`

Copy `env.example` to `.env` and set the required environment variables.

- Windows (PowerShell): `Copy-Item env.example .env`
- macOS/Linux: `cp env.example .env`

Other settings can be configured in `core/config.py`.

### 3) Run the UI

```bash
python app.py
```

Open `http://127.0.0.1:7860`.

## Repo layout (high level)

- `app.py`: Gradio UI entrypoint.
- `core/`: core components of the framework including workflow, agents, prompts, clients.
- `utils/`: helper scripts.
- `Benchmark/`: benchmark of scenarios from different regulations.
- `maps/`: CARLA maps.
- `assets/`: figures and demo media.
- `LICENSE`: CC BY-NC 4.0 license.

## License

Chat2Scenic is released under the [Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](LICENSE). You may share and adapt the code, benchmark, and materials for **non-commercial** purposes with appropriate credit. Commercial use requires prior written permission from the authors.

## Citation

<a id="citation"></a>

If you find Chat2Scenic useful, please cite our paper:

```bibtex
@article{gao2026chat2scenic,
  title={Chat2Scenic: An Iterative RAG-Based Framework for Scenario Generation in Autonomous Driving},
  author={Gao, Yuan and Miao, Wenting and Piccinini, Mattia and Wang, Haoyu and Song, Qunying and Betz, Johannes},
  journal={arXiv preprint arXiv:2607.14387},
  year={2026}
}
```
