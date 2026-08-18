#!/usr/bin/env python3
"""Qualification and reviewer calibration for the showcase production restart.

Three artefacts share one decision contract so a reviewer, a human labeller, and
the exit evaluator all speak the same language:

    semanticAccepted      the visible scene implements the requested mechanism
    presentationAccepted  the render is grounded, plausible, and defect-free
    defectCodes           sorted subset of DEFECT_CODES
    unsupportedReason     non-null only when the stack cannot represent the case

Gold decisions are immutable human labels.  The manifest is sealed with a
digest over its contract and entries, every entry is bound to the sha256 of the
bytes a reviewer actually saw, and any label carrying model provenance is
rejected outright.  Every loader here fails closed: a hash mismatch, a missing
evidence file, or an under-labelled manifest raises instead of degrading.

Nothing in this module performs network, simulator, or renderer work.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path


GOLD_SCHEMA = "uniscenarios.showcase-reviewer-gold.v1"
CALIBRATION_SCHEMA = "uniscenarios.showcase-reviewer-calibration.v1"
QUALIFICATION_SCHEMA = "uniscenarios.showcase-qualification.v1"
BREADTH_SCHEMA = "uniscenarios.showcase-breadth.v1"
VERDICT_SCHEMA = "uniscenarios.showcase-qualification-verdict.v1"

# The frozen product reviewer whose decisions this workflow calibrates.
REVIEW_VERSION = "showcase-3d-product-review-v4"
# tools/research/showcase/stages.py:470 accepts at realism >= 6.
REALISM_MIN = 6.0

DECISION_FIELDS = ("semanticAccepted", "presentationAccepted", "defectCodes", "unsupportedReason")
BOOLEAN_DECISION_FIELDS = ("semanticAccepted", "presentationAccepted")

DEFECT_CODES = (
    "actor-mismatch",
    "grounding-failure",
    "implausible",
    "low-realism",
    "mechanism-mismatch",
    "sequence-mismatch",
    "unsupported",
    "visible-defect",
)

# Keys and labeller names that only a model-produced review can carry.  Their
# presence proves the label was not hand-entered, so calibration must refuse it.
MODEL_PROVENANCE_KEYS = (
    "confidence",
    "effort",
    "explanation",
    "framesUsed",
    "latencyS",
    "model",
    "rawResponseSha256",
    "tokens",
    "version",
    "visionAsserted",
)
MODEL_LABELLER = re.compile(
    r"(?:^|[^a-z0-9])(?:gpt|claude|gemini|llama|o[0-9]|sol|luna|terra|vista|judge|model|llm|agent|bot)(?:[^a-z0-9]|$)",
    re.IGNORECASE,
)

STAGES = (
    "00-brief",
    "10-route",
    "15-precheck",
    "20-author",
    "30-sites",
    "40-cells",
    "50-gate",
    "60-render2d",
    "65-render3d",
    "70-judge",
    "80-repair",
    "90-gallery",
)
STAGE_OUTCOMES = ("pending", "running", "complete", "skipped", "failed")

ATTEMPT_OUTCOMES = ("semantic-accepted", "semantic-rejected", "unsupported", "operational-failure")

SHA256 = re.compile(r"^[a-f0-9]{64}$")
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")
CASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*$")

EXIT_QUALIFIED = 0
EXIT_NOT_QUALIFIED = 2


class QualificationError(ValueError):
    """Fail-closed refusal: never downgrade one of these into a soft verdict."""


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def sha256_json(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def dump_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(path)


# ------------------------------------------------------------------ contract

def decision_from_review(review):
    """Project a frozen `showcase-3d-product-review-v4` record onto the contract."""
    if review.get("version") not in (None, REVIEW_VERSION):
        raise QualificationError(f"review version {review.get('version')!r} is not {REVIEW_VERSION}")
    mechanism = str(review.get("mechanismFidelity", "no")).lower()
    grounding = str(review.get("visualGrounding", "fail")).lower()
    actors = str(review.get("actorFidelity", "fail")).lower()
    sequence = str(review.get("eventSequence", "fail")).lower()
    plausible = bool(review.get("plausible"))
    realism = float(review.get("realism", 0.0))
    defects = [item for item in review.get("defects", []) if str(item).strip()]
    codes = set()
    if mechanism != "yes":
        codes.add("mechanism-mismatch")
    if actors != "pass":
        codes.add("actor-mismatch")
    if sequence != "pass":
        codes.add("sequence-mismatch")
    if grounding != "pass":
        codes.add("grounding-failure")
    if not plausible:
        codes.add("implausible")
    if realism < REALISM_MIN:
        codes.add("low-realism")
    if defects:
        codes.add("visible-defect")
    return normalize_decision({
        "semanticAccepted": mechanism == "yes" and actors == "pass" and sequence == "pass",
        "presentationAccepted": grounding == "pass" and plausible and realism >= REALISM_MIN and not defects,
        "defectCodes": sorted(codes),
        "unsupportedReason": None,
    })


def normalize_decision(value, context="decision"):
    """Validate the four shared fields and return them in canonical form."""
    if not isinstance(value, dict):
        raise QualificationError(f"{context} must be an object")
    unknown = sorted(set(value) - set(DECISION_FIELDS))
    if unknown:
        raise QualificationError(f"{context} carries fields outside the contract: {', '.join(unknown)}")
    missing = [field for field in DECISION_FIELDS if field not in value]
    if missing:
        raise QualificationError(f"{context} is missing {', '.join(missing)}")
    for field in BOOLEAN_DECISION_FIELDS:
        if not isinstance(value[field], bool):
            raise QualificationError(f"{context}.{field} must be a boolean")
    codes = value["defectCodes"]
    if not isinstance(codes, list) or any(not isinstance(code, str) for code in codes):
        raise QualificationError(f"{context}.defectCodes must be a list of strings")
    unknown_codes = sorted(set(codes) - set(DEFECT_CODES))
    if unknown_codes:
        raise QualificationError(f"{context}.defectCodes has unknown codes: {', '.join(unknown_codes)}")
    if len(set(codes)) != len(codes):
        raise QualificationError(f"{context}.defectCodes repeats a code")
    reason = value["unsupportedReason"]
    if reason is not None and (not isinstance(reason, str) or not reason.strip()):
        raise QualificationError(f"{context}.unsupportedReason must be null or a non-empty string")
    if reason is None and "unsupported" in codes:
        raise QualificationError(f"{context} uses the unsupported defect code without a reason")
    if reason is not None:
        if value["semanticAccepted"] or value["presentationAccepted"]:
            raise QualificationError(f"{context} cannot accept footage it declares unsupported")
        if "unsupported" not in codes:
            raise QualificationError(f"{context} declares unsupportedReason without the unsupported defect code")
    return {
        "semanticAccepted": value["semanticAccepted"],
        "presentationAccepted": value["presentationAccepted"],
        "defectCodes": sorted(codes),
        "unsupportedReason": reason,
    }


def decision_of(record, context="decision"):
    return normalize_decision({field: record.get(field) for field in DECISION_FIELDS}, context)


# ------------------------------------------------------------- gold manifest

def _artifact(entry, key, context):
    artifact = entry.get(key)
    if not isinstance(artifact, dict):
        raise QualificationError(f"{context}.{key} must be an object with file and sha256")
    file = artifact.get("file")
    digest = artifact.get("sha256")
    if not isinstance(file, str) or not file or file.startswith("/") or ".." in Path(file).parts:
        raise QualificationError(f"{context}.{key}.file must be a repository-relative path")
    if not isinstance(digest, str) or not SHA256.match(digest):
        raise QualificationError(f"{context}.{key}.sha256 must be a lowercase sha256")
    return {"file": file, "sha256": digest}


def gold_seal(manifest):
    """Digest over everything a calibration run is allowed to depend on."""
    return sha256_json({
        "schema": manifest.get("schema"),
        "labelProvenance": manifest.get("labelProvenance"),
        "reviewContract": manifest.get("reviewContract"),
        "entries": manifest.get("entries"),
    })


def assert_human_label(label, context):
    if not isinstance(label, dict):
        raise QualificationError(f"{context} must be an object")
    inferred = sorted(set(label) & set(MODEL_PROVENANCE_KEYS))
    if inferred:
        raise QualificationError(
            f"{context} carries model provenance ({', '.join(inferred)}); gold decisions must be human labels")
    labeller = label.get("labeler")
    if not isinstance(labeller, str) or not labeller.strip():
        raise QualificationError(f"{context}.labeler is required")
    if MODEL_LABELLER.search(labeller):
        raise QualificationError(f"{context}.labeler {labeller!r} names a model; gold decisions must be human labels")
    labelled_at = label.get("labeledAt")
    if not isinstance(labelled_at, str) or not labelled_at.strip():
        raise QualificationError(f"{context}.labeledAt is required")
    unknown = sorted(set(label) - {"labeler", "labeledAt", *DECISION_FIELDS})
    if unknown:
        raise QualificationError(f"{context} carries unexpected fields: {', '.join(unknown)}")
    return {
        "labeler": labeller,
        "labeledAt": labelled_at,
        **decision_of(label, context),
    }


def load_gold(path, root):
    """Read, re-hash, and validate the gold manifest.  Raises on any doubt."""
    root = Path(root).resolve()
    manifest = load_json(path)
    if manifest.get("schema") != GOLD_SCHEMA:
        raise QualificationError(f"gold manifest schema {manifest.get('schema')!r} is not {GOLD_SCHEMA}")
    if manifest.get("labelProvenance") != "human":
        raise QualificationError("gold manifest labelProvenance must be human")
    contract = manifest.get("reviewContract")
    if not isinstance(contract, dict) or list(contract.get("fields", [])) != list(DECISION_FIELDS):
        raise QualificationError("gold manifest reviewContract.fields must be the shared decision contract")
    if contract.get("reviewVersion") != REVIEW_VERSION:
        raise QualificationError(f"gold manifest reviewContract.reviewVersion must be {REVIEW_VERSION}")
    if list(contract.get("defectCodes", [])) != list(DEFECT_CODES):
        raise QualificationError("gold manifest reviewContract.defectCodes must be the shared vocabulary")
    entries = manifest.get("entries")
    if not isinstance(entries, list) or not entries:
        raise QualificationError("gold manifest requires a non-empty entries array")
    if manifest.get("manifestSha256") != gold_seal(manifest):
        raise QualificationError("gold manifest seal does not match its contents; the manifest is immutable")

    seen_ids = set()
    by_video = {}
    resolved = []
    for entry in entries:
        evidence_id = entry.get("evidenceId")
        if not isinstance(evidence_id, str) or not evidence_id.strip():
            raise QualificationError("every gold entry requires an evidenceId")
        if evidence_id in seen_ids:
            raise QualificationError(f"gold entry {evidence_id} is duplicated")
        seen_ids.add(evidence_id)
        context = f"gold entry {evidence_id}"
        case_id = entry.get("caseId")
        if case_id is not None and (not isinstance(case_id, str) or not CASE_ID.match(case_id)):
            raise QualificationError(f"{context}.caseId must be null or a case id")
        request_text = entry.get("requestText")
        if not isinstance(request_text, str) or not request_text.strip():
            raise QualificationError(f"{context}.requestText is required to reproduce the brief-aware review")
        artifacts = {key: _artifact(entry, key, context) for key in ("video", "instance", "trace")}
        frames = entry.get("frames")
        if not isinstance(frames, list) or not frames:
            raise QualificationError(f"{context}.frames must list the exact reviewed key frames")
        frames = [_artifact({"frame": frame}, "frame", f"{context}.frames[{index}]")
                  for index, frame in enumerate(frames)]
        for key, artifact in [*artifacts.items(), *((f"frames[{index}]", frame)
                                                    for index, frame in enumerate(frames))]:
            file = (root / artifact["file"]).resolve()
            if not str(file).startswith(str(root)):
                raise QualificationError(f"{context}.{key}.file escapes the repository root")
            if not file.is_file():
                raise QualificationError(f"{context}.{key} evidence is missing: {artifact['file']}")
            observed = sha256_file(file)
            if observed != artifact["sha256"]:
                raise QualificationError(
                    f"{context}.{key} digest mismatch: manifest {artifact['sha256']} but bytes hash {observed}")
        label = entry.get("label")
        if label is not None:
            label = assert_human_label(label, f"{context}.label")
        video_sha = artifacts["video"]["sha256"]
        previous = by_video.get(video_sha)
        if previous is not None and previous.get("label") != label:
            raise QualificationError(
                f"identical footage {video_sha[:12]} carries conflicting gold labels "
                f"({previous['evidenceId']} and {evidence_id})")
        record = {"evidenceId": evidence_id, "caseId": case_id, "requestText": request_text,
                  **artifacts, "frames": frames, "label": label}
        by_video[video_sha] = record
        resolved.append(record)
    return {**manifest, "entries": resolved}


def eligible_gold(manifest):
    """Labelled, supported entries keyed by video digest — the calibration set."""
    eligible = {}
    for entry in manifest["entries"]:
        label = entry.get("label")
        if label is None or label["unsupportedReason"] is not None:
            continue
        eligible[entry["video"]["sha256"]] = entry
    return eligible


# ---------------------------------------------------- repetitions and metrics

def group_reviews_by_evidence(reviews, repetitions, gold=None):
    """Group repeated reviews by the digest of the footage that was reviewed.

    Grouping is on evidence bytes, never on a scenario or case name: two reviews
    only belong together when the reviewer saw byte-identical footage.
    """
    if not isinstance(repetitions, int) or repetitions < 2:
        raise QualificationError("repetitions must be an integer of at least 2")
    groups = {}
    for index, review in enumerate(reviews):
        context = f"review {index}"
        digest = review.get("videoSha256")
        if not isinstance(digest, str) or not SHA256.match(digest):
            raise QualificationError(f"{context} is missing a videoSha256 evidence digest")
        if review.get("reviewVersion") != REVIEW_VERSION:
            raise QualificationError(f"{context} was produced by {review.get('reviewVersion')!r}, not {REVIEW_VERSION}")
        realism = review.get("realism")
        if not isinstance(realism, (int, float)) or isinstance(realism, bool):
            raise QualificationError(f"{context} is missing a numeric realism score")
        groups.setdefault(digest, []).append({
            "videoSha256": digest,
            "repetition": review.get("repetition"),
            "realism": float(realism),
            **decision_of(review, context),
        })
    if gold is not None:
        unknown = sorted(set(groups) - set(gold))
        if unknown:
            raise QualificationError(
                f"reviews reference footage absent from the gold manifest: {', '.join(item[:12] for item in unknown)}")
        missing = sorted(set(gold) - set(groups))
        if missing:
            raise QualificationError(
                f"gold footage was never reviewed: {', '.join(item[:12] for item in missing)}")
    short = sorted(digest for digest, items in groups.items() if len(items) != repetitions)
    if short:
        raise QualificationError(
            f"identical-footage repetitions must be exactly {repetitions} per evidence; "
            f"wrong count for {', '.join(item[:12] for item in short)}")
    return {digest: groups[digest] for digest in sorted(groups)}


def _rate(numerator, denominator):
    return None if denominator == 0 else round(numerator / denominator, 6)


def confusion_matrix(gold, groups, field):
    """Per-review confusion against gold; every repetition counts as one call."""
    counts = {"truePositive": 0, "falsePositive": 0, "trueNegative": 0, "falseNegative": 0}
    for digest, reviews in groups.items():
        truth = gold[digest]["label"][field]
        for review in reviews:
            observed = review[field]
            if truth and observed:
                counts["truePositive"] += 1
            elif truth and not observed:
                counts["falseNegative"] += 1
            elif not truth and observed:
                counts["falsePositive"] += 1
            else:
                counts["trueNegative"] += 1
    counts["reviews"] = sum(counts[key] for key in
                            ("truePositive", "falsePositive", "trueNegative", "falseNegative"))
    counts["falsePositiveRate"] = _rate(counts["falsePositive"], counts["falsePositive"] + counts["trueNegative"])
    counts["falseNegativeRate"] = _rate(counts["falseNegative"], counts["falseNegative"] + counts["truePositive"])
    counts["accuracy"] = _rate(counts["truePositive"] + counts["trueNegative"], counts["reviews"])
    return counts


def _field_value(review, field):
    if field == "defectCodes":
        return tuple(review[field])
    return review[field]


def flip_rates(groups):
    """A field flips when repeated reviews of identical footage disagree."""
    per_field = {}
    flipped_groups = set()
    for field in DECISION_FIELDS:
        flipped = [digest for digest, reviews in groups.items()
                   if len({_field_value(review, field) for review in reviews}) > 1]
        flipped_groups.update(flipped)
        per_field[field] = {"evidence": len(groups), "flipped": len(flipped),
                            "rate": _rate(len(flipped), len(groups))}
    return {
        "evidence": len(groups),
        "flippedEvidence": len(flipped_groups),
        "rate": _rate(len(flipped_groups), len(groups)),
        "byField": per_field,
    }


def _stdev(values):
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((value - mean) ** 2 for value in values) / (len(values) - 1))


def realism_dispersion(groups):
    """Within-footage realism spread: the same video judged repeatedly."""
    per_group = {digest: round(_stdev([review["realism"] for review in reviews]), 6)
                 for digest, reviews in groups.items()}
    values = list(per_group.values())
    return {
        "evidence": len(values),
        "meanSd": round(sum(values) / len(values), 6) if values else None,
        "maxSd": round(max(values), 6) if values else None,
        "pooledSd": round(math.sqrt(sum(value ** 2 for value in values) / len(values)), 6) if values else None,
        "byEvidence": per_group,
    }


def build_calibration(manifest, reviews, repetitions):
    gold = eligible_gold(manifest)
    if not gold:
        raise QualificationError("the gold manifest carries no labelled, supported entries to calibrate against")
    groups = group_reviews_by_evidence(reviews, repetitions, gold)
    unsupported = [entry["evidenceId"] for entry in manifest["entries"]
                   if entry.get("label") and entry["label"]["unsupportedReason"] is not None]
    return {
        "schema": CALIBRATION_SCHEMA,
        "reviewVersion": REVIEW_VERSION,
        "goldSha256": manifest["manifestSha256"],
        "repetitions": repetitions,
        "labelledEvidence": len(gold),
        "unlabelledEvidence": sum(1 for entry in manifest["entries"] if entry.get("label") is None),
        "unsupportedEvidence": sorted(unsupported),
        "reviews": sum(len(items) for items in groups.values()),
        "confusion": {field: confusion_matrix(gold, groups, field) for field in BOOLEAN_DECISION_FIELDS},
        "flip": flip_rates(groups),
        "realism": realism_dispersion(groups),
    }


# --------------------------------------------------------------- run configs

def load_breadth(path):
    config = load_json(path)
    if config.get("schema") != BREADTH_SCHEMA:
        raise QualificationError(f"breadth config schema {config.get('schema')!r} is not {BREADTH_SCHEMA}")
    cases = config.get("cases")
    if not isinstance(cases, list) or not cases:
        raise QualificationError("breadth config requires a non-empty cases array")
    expected = config.get("caseCount")
    if not isinstance(expected, int) or expected != len(cases):
        raise QualificationError(f"breadth config declares caseCount {expected!r} but carries {len(cases)} cases")
    stages = list(config.get("stages", []))
    if stages != list(STAGES):
        raise QualificationError("breadth config stages must be the exact showcase pipeline stages")
    required = list(config.get("requiredStages", []))
    if not required or any(stage not in stages for stage in required):
        raise QualificationError("breadth config requiredStages must be a non-empty subset of stages")
    ids = []
    for case in cases:
        case_id = case.get("id")
        if not isinstance(case_id, str) or not SLUG.match(case_id):
            raise QualificationError(f"breadth case id {case_id!r} must be a lowercase slug")
        if not isinstance(case.get("title"), str) or not case["title"].strip():
            raise QualificationError(f"breadth case {case_id} requires a title")
        outcomes = case.get("stageOutcomes")
        if not isinstance(outcomes, dict) or sorted(outcomes) != sorted(stages):
            raise QualificationError(f"breadth case {case_id} must record an outcome for every stage")
        unknown = sorted({value for value in outcomes.values() if value not in STAGE_OUTCOMES})
        if unknown:
            raise QualificationError(f"breadth case {case_id} has unknown stage outcomes: {', '.join(unknown)}")
        ids.append(case_id)
    if len(set(ids)) != len(ids):
        raise QualificationError("breadth config repeats a case id")
    return {**config, "caseIds": ids}


def load_qualification(path, breadth):
    config = load_json(path)
    if config.get("schema") != QUALIFICATION_SCHEMA:
        raise QualificationError(f"qualification config schema {config.get('schema')!r} is not {QUALIFICATION_SCHEMA}")
    attempts = config.get("attemptsPerCase")
    if not isinstance(attempts, int) or attempts < 1:
        raise QualificationError("qualification attemptsPerCase must be a positive integer")
    cases = config.get("cases")
    if not isinstance(cases, list) or not cases:
        raise QualificationError("qualification config requires a non-empty cases array")
    known = set(breadth["caseIds"])
    ids = []
    for case in cases:
        case_id = case.get("id")
        if not isinstance(case_id, str) or not CASE_ID.match(case_id):
            raise QualificationError(f"qualification case id {case_id!r} is not a case id")
        breadth_id = case.get("breadthCaseId")
        if breadth_id not in known:
            raise QualificationError(
                f"qualification case {case_id} maps to breadthCaseId {breadth_id!r}, which is not in the breadth config")
        if not isinstance(case.get("family"), str) or not case["family"].strip():
            raise QualificationError(f"qualification case {case_id} requires a family")
        ids.append(case_id)
    if len(set(ids)) != len(ids):
        raise QualificationError("qualification config repeats a case id")
    exit_criteria = config.get("exit")
    if not isinstance(exit_criteria, dict):
        raise QualificationError("qualification config requires an exit object")
    numbers = {
        "semanticYieldMin": (float, 0.0, 1.0),
        "reviewerFlipRateMax": (float, 0.0, 1.0),
        "casesMeetingYieldMin": (int, 1, len(cases)),
        "maxOperationalFailures": (int, 0, attempts * len(cases)),
        "reviewRepetitions": (int, 2, 100),
        "minimumGoldLabels": (int, 1, 10_000),
    }
    for key, (kind, low, high) in numbers.items():
        value = exit_criteria.get(key)
        if kind is int and (not isinstance(value, int) or isinstance(value, bool)):
            raise QualificationError(f"qualification exit.{key} must be an integer")
        if kind is float and (not isinstance(value, (int, float)) or isinstance(value, bool)):
            raise QualificationError(f"qualification exit.{key} must be a number")
        if not low <= value <= high:
            raise QualificationError(f"qualification exit.{key} must be within [{low}, {high}]")
    return {**config, "caseIds": ids}


# ------------------------------------------------------------ exit evaluation

def attempt_outcome(attempt, judge=None):
    """Classify one campaign attempt into exactly one qualification outcome.

    Operational failures (infrastructure, gateway, crash) are never a semantic
    verdict, so they stay out of the yield denominator and are counted on their
    own.  An unsupported attempt is a representability result, not a defect.
    """
    if not isinstance(attempt, dict):
        raise QualificationError("attempt must be an object")
    number = attempt.get("number")
    if not isinstance(number, int) or isinstance(number, bool) or number < 1:
        raise QualificationError("attempt.number must be a positive integer")
    reason = attempt.get("unsupportedReason")
    if isinstance(reason, str) and reason.strip():
        return {"number": number, "outcome": "unsupported", "decision": normalize_decision({
            "semanticAccepted": False, "presentationAccepted": False,
            "defectCodes": ["unsupported"], "unsupportedReason": reason,
        }), "videoSha256": None}
    if attempt.get("status") != "complete":
        return {"number": number, "outcome": "operational-failure", "decision": None, "videoSha256": None}
    rows = [row for row in (judge or {}).get("cells", []) if row.get("status") == "complete"]
    review = next((row.get("threeDReview") for row in rows
                   if isinstance(row.get("threeDReview"), dict)
                   and row["threeDReview"].get("version") == REVIEW_VERSION), None)
    if review is None:
        return {"number": number, "outcome": "operational-failure", "decision": None, "videoSha256": None}
    decision = decision_from_review(review)
    return {
        "number": number,
        "outcome": "semantic-accepted" if decision["semanticAccepted"] else "semantic-rejected",
        "decision": decision,
        "videoSha256": attempt.get("videoSha256"),
    }


def summarize_case(case_id, attempts_per_case, outcomes):
    counted = [item for item in outcomes if item["outcome"] != "operational-failure"]
    accepted = [item for item in counted if item["outcome"] == "semantic-accepted"]
    return {
        "caseId": case_id,
        "attemptsPlanned": attempts_per_case,
        "attemptsObserved": len(outcomes),
        "operationalFailures": sum(1 for item in outcomes if item["outcome"] == "operational-failure"),
        "unsupported": sum(1 for item in outcomes if item["outcome"] == "unsupported"),
        "semanticAccepted": len(accepted),
        "semanticRejected": sum(1 for item in counted if item["outcome"] == "semantic-rejected"),
        "countedAttempts": len(counted),
        "semanticYield": _rate(len(accepted), len(counted)),
        "outcomes": outcomes,
    }


def evaluate_exit(config, calibration, case_outcomes):
    """Machine exit evaluator: a verdict plus the process exit code to use."""
    criteria = config["exit"]
    if calibration.get("schema") != CALIBRATION_SCHEMA:
        raise QualificationError(f"calibration schema {calibration.get('schema')!r} is not {CALIBRATION_SCHEMA}")
    if calibration.get("reviewVersion") != REVIEW_VERSION:
        raise QualificationError("calibration was produced by a different reviewer version")
    if calibration.get("repetitions") != criteria["reviewRepetitions"]:
        raise QualificationError(
            f"calibration used {calibration.get('repetitions')} repetitions but the config requires "
            f"{criteria['reviewRepetitions']}")
    missing = sorted(set(config["caseIds"]) - set(case_outcomes))
    if missing:
        raise QualificationError(f"no attempts were supplied for {', '.join(missing)}")
    extra = sorted(set(case_outcomes) - set(config["caseIds"]))
    if extra:
        raise QualificationError(f"attempts were supplied for unknown cases: {', '.join(extra)}")

    cases = [summarize_case(case["id"], config["attemptsPerCase"], case_outcomes[case["id"]])
             for case in config["cases"]]
    for case in cases:
        if case["attemptsObserved"] != config["attemptsPerCase"]:
            raise QualificationError(
                f"case {case['caseId']} recorded {case['attemptsObserved']} attempts but the config plans "
                f"{config['attemptsPerCase']}")

    meeting = [case["caseId"] for case in cases
               if case["semanticYield"] is not None and case["semanticYield"] >= criteria["semanticYieldMin"]]
    operational = sum(case["operationalFailures"] for case in cases)
    labelled = calibration["labelledEvidence"]
    flip = calibration["flip"]["rate"]

    checks = [
        {
            "id": "semantic-yield",
            "threshold": f">= {criteria['semanticYieldMin']} on >= {criteria['casesMeetingYieldMin']} of {len(cases)} cases",
            "observed": {"casesMeeting": len(meeting), "cases": sorted(meeting),
                         "yields": {case["caseId"]: case["semanticYield"] for case in cases}},
            "pass": len(meeting) >= criteria["casesMeetingYieldMin"],
        },
        {
            "id": "reviewer-flip",
            "threshold": f"< {criteria['reviewerFlipRateMax']}",
            "observed": {"flipRate": flip, "byField": calibration["flip"]["byField"],
                         "realismSd": calibration["realism"]["meanSd"]},
            "pass": flip is not None and flip < criteria["reviewerFlipRateMax"],
        },
        {
            "id": "operational-failures",
            "threshold": f"<= {criteria['maxOperationalFailures']}",
            "observed": {"operationalFailures": operational},
            "pass": operational <= criteria["maxOperationalFailures"],
        },
        {
            "id": "gold-labels",
            "threshold": f">= {criteria['minimumGoldLabels']}",
            "observed": {"labelledEvidence": labelled},
            "pass": labelled >= criteria["minimumGoldLabels"],
        },
    ]
    qualified = all(check["pass"] for check in checks)
    verdict = {
        "schema": VERDICT_SCHEMA,
        "qualificationId": config.get("id"),
        "reviewVersion": REVIEW_VERSION,
        "goldSha256": calibration["goldSha256"],
        "qualified": qualified,
        "exitCode": EXIT_QUALIFIED if qualified else EXIT_NOT_QUALIFIED,
        "blockers": [check["id"] for check in checks if not check["pass"]],
        "checks": checks,
        "cases": cases,
        "totals": {
            "attempts": sum(case["attemptsObserved"] for case in cases),
            "countedAttempts": sum(case["countedAttempts"] for case in cases),
            "semanticAccepted": sum(case["semanticAccepted"] for case in cases),
            "unsupported": sum(case["unsupported"] for case in cases),
            "operationalFailures": operational,
        },
    }
    return verdict
