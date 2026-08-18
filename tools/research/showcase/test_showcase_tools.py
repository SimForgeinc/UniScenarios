#!/usr/bin/env python3
"""Focused unit tests for P5 glue; no gateway, simulator, or renderer calls."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


author = load("author_one")
gallery = load("preseed_gallery")
semantic = load("semantic_contract")
review = load("review_contract")
stages = load("stages")
qual = load("qualification")

FULL_REVIEW = {"tier": "3d", "mechanismFidelity": "yes", "visualGrounding": "pass",
               "actorFidelity": "pass", "eventSequence": "pass", "plausible": True,
               "realism": 7, "confidence": 0.8, "defects": [],
               "explanation": "The requested mechanism happens on camera on solid ground."}


def candidate(root, cell, story, gate, realism, dynamism):
    return {"root": Path(root), "cell": Path(root) / cell,
            "meta": {"cellId": cell, "briefId": story, "gate": {"pass": gate}},
            "verdict": {"realism": realism, "dynamism": dynamism, "confidence": 0.8}}


class AuthorHelpersTest(unittest.TestCase):
    def test_stage_layout_and_category(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(author._stage_dir(tmp), Path(tmp).resolve() / "20-author")
        self.assertEqual(author._category("a slower lead vehicle brakes hard"), "longitudinal")
        self.assertEqual(author._category("a cyclist emerges from behind a van"), "vru")

    def test_slug_is_stable_and_bounded(self):
        value = author._slug("A" * 200)
        self.assertEqual(value, author._slug("A" * 200))
        self.assertLessEqual(len(value), 64)

    def test_authoring_enforces_twenty_second_minimum_clip(self):
        with tempfile.TemporaryDirectory() as tmp:
            template = Path(tmp) / "template.json"
            template.write_text(json.dumps({"choreography": {"clipSeconds": 16}}))
            self.assertEqual(author._enforce_minimum_clip(template), 20.0)
            self.assertEqual(json.loads(template.read_text())["choreography"]["clipSeconds"], 20.0)
            template.write_text(json.dumps({"choreography": {"clipSeconds": 24}}))
            self.assertEqual(author._enforce_minimum_clip(template), 24.0)


class SemanticContractTest(unittest.TestCase):
    BRIEF = {
        "id": "motorcycle-reveal",
        "brief": "At a signalized intersection the ego turns left. An oncoming SUV blocks the ego's view of a motorcycle lane-splitting between lanes. The motorcycle emerges late and the ego brakes and stops partially across the intersection without collision.",
    }

    def test_rejects_description_only_mechanism(self):
        contract = semantic.derive_contract(
            self.BRIEF, ["junction_any", "junction_signalized", "oncoming_lane"])
        template = {
            "anchor": {"corridor": {"throughLanesOpposing": {"value": [2, 4], "essentiality": "required"}}, "features": []},
            "roles": [
                {"id": "ego", "actor": {"class": "car", "catalogId": "vehicle.sedan"}},
                {"id": "motorcycle", "actor": {"class": "motorcycle", "catalogId": "vehicle.motorcycle"}, "tFrac": 0},
                {"id": "suv", "actor": {"class": "car", "catalogId": "vehicle.suv"}, "headingOffsetRad": 3.14159},
            ],
            "choreography": {"clipSeconds": 16, "interactions": []},
            "invariants": [],
        }
        failures = {item["kind"] for item in semantic.validate_template(template, contract)}
        self.assertTrue({"signalized_junction", "ego_left_turn", "declared_occlusion",
                         "lane_splitting_actor", "ego_braking_response",
                         "minimum_clip", "required_invariants"}.issubset(failures))

    def test_accepts_executable_contract(self):
        contract = semantic.derive_contract(
            self.BRIEF, ["junction_any", "junction_signalized", "oncoming_lane"])
        template = {
            "anchor": {
                "corridor": {"throughLanesOpposing": {"value": [2, 4], "essentiality": "required"}},
                "features": [{"id": "jx", "kind": "junction", "essentiality": "required",
                              "control": {"value": ["signalized"], "essentiality": "required"},
                              "egoTurn": {"value": ["left"], "essentiality": "required"}}],
            },
            "roles": [
                {"id": "ego", "actor": {"class": "car", "catalogId": "vehicle.sedan"}},
                {"id": "motorcycle", "actor": {"class": "motorcycle", "catalogId": "vehicle.motorcycle"},
                 "tFrac": 0.9, "headingOffsetRad": 3.14159},
                {"id": "suv", "actor": {"class": "car", "catalogId": "vehicle.suv"},
                 "headingOffsetRad": 3.14159,
                 "extensions": {"occludes": {"observer": "ego", "target": "motorcycle"}}},
            ],
            "choreography": {"clipSeconds": 20, "interactions": [
                {"actor": "ego", "verb": "speed", "trigger": {"kind": "at", "t": 5},
                 "target": {"mode": "stop"}},
            ]},
            "invariants": [{"id": "criticality", "kind": "ttc", "essentiality": "required"}],
        }
        self.assertEqual(semantic.validate_template(template, contract), [])

    def test_proven_motorcycle_fallback_executes_contract(self):
        contract = semantic.derive_contract(
            self.BRIEF, ["junction_any", "junction_signalized", "oncoming_lane"])
        root = HERE.parents[2]
        template = semantic.build_proven_ltap_variant(contract, self.BRIEF, root)
        self.assertIsNotNone(template)
        roles = {role["id"]: role for role in template["roles"]}
        self.assertEqual(roles["motorcycle"]["kind"], "conflicting_gate")
        self.assertEqual(roles["occluding_suv"]["kind"], "conflicting_gate")
        self.assertEqual(roles["motorcycle"]["tFrac"], 0.45)
        self.assertEqual(roles["occluding_suv"]["tFrac"], 0.3)
        self.assertEqual(semantic.validate_template(template, contract), [])



class ReviewContractTest(unittest.TestCase):
    """The acceptance contract is shared with JavaScript, so hash and verdicts are both frozen."""

    def test_declared_hash_matches_the_canonical_body(self):
        body = {key: value for key, value in review.CONTRACT.items() if key != "sha256"}
        self.assertEqual(review.CONTRACT_SHA256, review.sha256_text(review.canonical_json(body)))
        # Integral floats serialise as '1.0' here and '1' in JavaScript, which would fork the hash.
        self.assertEqual(review._integral_floats(body), [])

    def test_every_conformance_vector_agrees_with_the_predicates(self):
        self.assertGreaterEqual(len(review.CONTRACT["conformance"]), 10)
        for vector in review.CONTRACT["conformance"]:
            with self.subTest(vector["name"]):
                got = review.evaluate(vector["review"])
                self.assertEqual(
                    {"semanticAccepted": got["semanticAccepted"],
                     "presentationAccepted": got["presentationAccepted"],
                     "defectCodes": got["defectCodes"],
                     "unsupported": got["unsupportedReason"] is not None},
                    {"semanticAccepted": vector["expect"]["semanticAccepted"],
                     "presentationAccepted": vector["expect"]["presentationAccepted"],
                     "defectCodes": vector["expect"]["defectCodes"],
                     "unsupported": vector["expect"]["unsupported"]})

    def test_presentation_defects_never_reject_a_correct_scenario(self):
        got = review.evaluate({**FULL_REVIEW, "visualGrounding": "fail", "defects": [
            {"code": "render.camera.framing", "text": "the conflict is cropped at the right edge"},
            {"code": "render.asset.grounding", "text": "the sedan hovers above the lane",
             "confidence": 0.7}]})
        self.assertTrue(got["semanticAccepted"])
        self.assertFalse(got["presentationAccepted"])
        self.assertIsNone(got["unsupportedReason"])
        self.assertEqual(got["defectCodes"], ["render.asset.grounding", "render.camera.framing"])
        preserved = [(item["text"], item["confidence"]) for item in got["defects"]
                     if item["source"] == "model"]
        self.assertEqual(preserved, [("the conflict is cropped at the right edge", 0.8),
                                     ("the sedan hovers above the lane", 0.7)])

    def test_scenario_defects_and_silent_reviews_fail_both_verdicts(self):
        sequence = review.evaluate({**FULL_REVIEW, "eventSequence": "fail"})
        self.assertEqual((sequence["semanticAccepted"], sequence["presentationAccepted"]), (False, False))
        self.assertEqual(sequence["defectCodes"], ["scenario.sequence"])
        silent = review.evaluate({**FULL_REVIEW, "explanation": "  "})
        self.assertEqual((silent["semanticAccepted"], silent["presentationAccepted"]), (False, False))
        self.assertEqual(silent["defectCodes"], ["judge.uncertain"])
        self.assertIn("no explanatory text", silent["unsupportedReason"])

    def test_retry_recommendation_and_historical_normalization(self):
        self.assertEqual(review.retry_recommendation(["render.camera.framing", "scenario.gate"], 2),
                         {"action": "reauthor", "codes": ["scenario.gate"],
                          "reason": "dominant defect prefix scenario."})
        self.assertEqual(review.retry_recommendation(["render.asset.lod"], 2)["action"], "recompose")
        self.assertIsNone(review.retry_recommendation([], 2))
        self.assertEqual(review.retry_recommendation([], 0)["action"], "reauthor")
        legacy = review.normalize_historical(
            {**FULL_REVIEW, "version": "showcase-3d-product-review-v4", "accepted": True})
        self.assertTrue(legacy["semanticAccepted"])
        self.assertTrue(legacy["presentationAccepted"])
        self.assertIsNone(legacy["contract"], "a normalized verdict can never claim the current contract")
        self.assertEqual(legacy["normalizedFrom"], "showcase-3d-product-review-v4")

    def test_review_emission_preserves_raw_defect_evidence(self):
        self.assertEqual(
            stages.raw_defects([{"code": " render.camera.framing ", "text": "cropped", "confidence": 2},
                                "frozen_actor", {"description": "no text key"}]),
            [{"text": "cropped", "code": "render.camera.framing", "confidence": 1.0},
             "frozen_actor",
             {"text": "no text key"}])
        self.assertEqual(stages.raw_defects(None), [])


class GallerySelectionTest(unittest.TestCase):
    def test_map_id_comes_from_instance_evidence(self):
        instance = {"manifest": {"replayKey": {"mapId": "yale-street"}}}
        self.assertEqual(gallery._map_id(instance, {"map": "street"}), "yale-street")

    def test_gate_is_primary_rank(self):
        passing = candidate("/a", "pass", "one", True, 1, 1)
        failing = candidate("/a", "fail", "two", False, 10, 10)
        got = gallery.select({Path("/a"): [passing, failing]}, 1)
        self.assertEqual(got[0]["meta"]["cellId"], "pass")

    def test_each_live_root_gets_quota_and_stories_are_unique(self):
        roots = {}
        for root in ("/a", "/b"):
            roots[Path(root)] = [candidate(root, f"{root[-1]}-{n}", f"story-{root[-1]}-{n}",
                                           True, 9 - n, 8) for n in range(3)]
        got = gallery.select(roots, 4)
        self.assertEqual(len(got), 4)
        self.assertEqual({item["root"] for item in got}, {Path("/a"), Path("/b")})
        self.assertEqual(len({_story(item) for item in got}), 4)


def _human_label(semantic_accepted, presentation_accepted=True, codes=(), reason=None):
    return {"labeler": "hana.ito", "labeledAt": "2026-08-18T09:00:00Z",
            "semanticAccepted": semantic_accepted, "presentationAccepted": presentation_accepted,
            "defectCodes": list(codes), "unsupportedReason": reason}


def _write_evidence(root, evidence_id, payload):
    video = root / "videos" / f"{evidence_id}.mp4"
    frame = root / "videos" / f"{evidence_id}-frame-000.png"
    instance = root / "cells" / evidence_id / "instance.json"
    trace = root / "cells" / evidence_id / "trace.json.gz"
    for path, blob in ((video, payload), (frame, payload + b"f"),
                       (instance, b"{}"), (trace, b"\x1f\x8b")):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blob)
    return {"evidenceId": evidence_id, "caseId": None, "requestText": f"request for {evidence_id}",
            "video": {"file": str(video.relative_to(root)), "sha256": qual.sha256_file(video)},
            "frames": [{"file": str(frame.relative_to(root)), "sha256": qual.sha256_file(frame)}],
            "instance": {"file": str(instance.relative_to(root)), "sha256": qual.sha256_file(instance)},
            "trace": {"file": str(trace.relative_to(root)), "sha256": qual.sha256_file(trace)},
            "label": None}


def _seal(root, entries):
    manifest = {"schema": qual.GOLD_SCHEMA, "id": "test-gold", "labelProvenance": "human",
                "reviewContract": {"fields": list(qual.DECISION_FIELDS),
                                   "defectCodes": list(qual.DEFECT_CODES),
                                   "reviewVersion": qual.REVIEW_VERSION,
                                   "realismMin": qual.REALISM_MIN},
                "entries": entries}
    manifest["manifestSha256"] = qual.gold_seal(manifest)
    path = root / "gold.json"
    qual.dump_json(path, manifest)
    return path


class DecisionContractTest(unittest.TestCase):
    def test_reviewer_output_splits_into_semantic_and_presentation(self):
        review = {"version": qual.REVIEW_VERSION, "mechanismFidelity": "yes", "visualGrounding": "pass",
                  "actorFidelity": "pass", "eventSequence": "pass", "plausible": True,
                  "realism": 8.0, "defects": []}
        self.assertEqual(qual.decision_from_review(review),
                         {"semanticAccepted": True, "presentationAccepted": True,
                          "defectCodes": [], "unsupportedReason": None})
        review["mechanismFidelity"] = "partial"
        review["realism"] = 4.0
        degraded = qual.decision_from_review(review)
        self.assertFalse(degraded["semanticAccepted"])
        self.assertFalse(degraded["presentationAccepted"])
        self.assertEqual(degraded["defectCodes"], ["low-realism", "mechanism-mismatch"])

    def test_unsupported_decisions_cannot_also_accept(self):
        with self.assertRaises(qual.QualificationError):
            qual.normalize_decision({"semanticAccepted": True, "presentationAccepted": False,
                                     "defectCodes": ["unsupported"], "unsupportedReason": "no crossing primitive"})
        with self.assertRaises(qual.QualificationError):
            qual.normalize_decision({"semanticAccepted": False, "presentationAccepted": False,
                                     "defectCodes": ["invented-code"], "unsupportedReason": None})


class GoldManifestTest(unittest.TestCase):
    def test_hash_mismatch_and_missing_evidence_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            entry = _write_evidence(root, "cell-a", b"footage-a")
            path = _seal(root, [entry])
            self.assertEqual(len(qual.load_gold(path, root)["entries"]), 1)
            (root / entry["video"]["file"]).write_bytes(b"footage-a-edited")
            with self.assertRaisesRegex(qual.QualificationError, "digest mismatch"):
                qual.load_gold(path, root)
            (root / entry["video"]["file"]).unlink()
            with self.assertRaisesRegex(qual.QualificationError, "evidence is missing"):
                qual.load_gold(path, root)

    def test_seal_makes_the_manifest_immutable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = _seal(root, [_write_evidence(root, "cell-a", b"footage-a")])
            manifest = json.loads(path.read_text())
            manifest["entries"][0]["label"] = _human_label(True)
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(qual.QualificationError, "immutable"):
                qual.load_gold(path, root)

    def test_model_generated_labels_cannot_be_calibrated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            entry = _write_evidence(root, "cell-a", b"footage-a")
            inferred = {**_human_label(True), "model": "gpt-5.6-sol", "confidence": 0.9}
            with self.assertRaisesRegex(qual.QualificationError, "model provenance"):
                qual.load_gold(_seal(root, [{**entry, "label": inferred}]), root)
            named = {**_human_label(True), "labeler": "gpt-5.6-sol"}
            with self.assertRaisesRegex(qual.QualificationError, "names a model"):
                qual.load_gold(_seal(root, [{**entry, "label": named}]), root)
            manifest = json.loads(_seal(root, [{**entry, "label": _human_label(True)}]).read_text())
            manifest["labelProvenance"] = "model"
            path = root / "inferred.json"
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(qual.QualificationError, "labelProvenance must be human"):
                qual.load_gold(path, root)

    def test_unsupported_entries_are_recorded_but_not_calibrated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            supported = {**_write_evidence(root, "cell-a", b"footage-a"), "label": _human_label(True)}
            unsupported = {**_write_evidence(root, "cell-b", b"footage-b"),
                           "label": _human_label(False, False, ["unsupported"], "no reversible-lane primitive")}
            manifest = qual.load_gold(_seal(root, [supported, unsupported]), root)
            self.assertEqual(sorted(entry["evidenceId"] for entry in manifest["entries"]), ["cell-a", "cell-b"])
            self.assertEqual([entry["evidenceId"] for entry in qual.eligible_gold(manifest).values()], ["cell-a"])


class CalibrationTest(unittest.TestCase):
    @staticmethod
    def _review(digest, repetition, semantic_accepted, realism, presentation=True):
        return {"videoSha256": digest, "repetition": repetition, "reviewVersion": qual.REVIEW_VERSION,
                "realism": realism, "semanticAccepted": semantic_accepted,
                "presentationAccepted": presentation, "defectCodes": [], "unsupportedReason": None}

    def test_repetitions_group_by_evidence_digest_not_by_name(self):
        digest_a, digest_b = "a" * 64, "b" * 64
        reviews = [self._review(digest_a, n, True, 8.0) for n in (1, 2, 3)]
        reviews += [self._review(digest_b, n, False, 4.0) for n in (1, 2, 3)]
        groups = qual.group_reviews_by_evidence(reviews, 3)
        self.assertEqual(sorted(groups), [digest_a, digest_b])
        self.assertEqual([len(items) for items in groups.values()], [3, 3])
        with self.assertRaisesRegex(qual.QualificationError, "exactly 3"):
            qual.group_reviews_by_evidence(reviews[:-1], 3)

    def test_confusion_flip_and_realism_spread(self):
        digest_a, digest_b = "a" * 64, "b" * 64
        gold = {digest_a: {"label": _human_label(True)}, digest_b: {"label": _human_label(False)}}
        groups = qual.group_reviews_by_evidence(
            [self._review(digest_a, 1, True, 8.0), self._review(digest_a, 2, True, 8.0),
             self._review(digest_a, 3, False, 5.0),
             self._review(digest_b, 1, False, 3.0), self._review(digest_b, 2, False, 3.0),
             self._review(digest_b, 3, False, 3.0)], 3)
        matrix = qual.confusion_matrix(gold, groups, "semanticAccepted")
        self.assertEqual([matrix["truePositive"], matrix["falseNegative"],
                          matrix["falsePositive"], matrix["trueNegative"]], [2, 1, 0, 3])
        self.assertEqual(matrix["falsePositiveRate"], 0.0)
        self.assertEqual(round(matrix["falseNegativeRate"], 4), 0.3333)
        flips = qual.flip_rates(groups)
        self.assertEqual(flips["rate"], 0.5)
        self.assertEqual(flips["byField"]["semanticAccepted"]["flipped"], 1)
        self.assertEqual(flips["byField"]["presentationAccepted"]["flipped"], 0)
        realism = qual.realism_dispersion(groups)
        self.assertEqual(realism["byEvidence"][digest_b], 0.0)
        self.assertGreater(realism["byEvidence"][digest_a], 0.0)
        self.assertEqual(realism["maxSd"], realism["byEvidence"][digest_a])


class BreadthAndQualificationConfigTest(unittest.TestCase):
    def test_committed_breadth_config_covers_every_campaign_case(self):
        breadth = qual.load_breadth(REPO / "apps/showcase/campaigns/breadth.json")
        campaign = qual.load_json(REPO / "apps/showcase/campaigns/edge-cases.json")
        expected = [case["id"] for case in campaign["cases"]]
        self.assertEqual(len(expected), 67)
        self.assertEqual(breadth["caseIds"], expected)
        self.assertEqual(breadth["caseCount"], 67)
        for case in breadth["cases"]:
            self.assertEqual(sorted(case["stageOutcomes"]), sorted(qual.STAGES))
            self.assertEqual(set(case["stageOutcomes"].values()), {"pending"})

    def test_committed_qualification_config_declares_the_exact_thresholds(self):
        breadth = qual.load_breadth(REPO / "apps/showcase/campaigns/breadth.json")
        config = qual.load_qualification(REPO / "apps/showcase/campaigns/qualification.json", breadth)
        self.assertEqual(config["caseIds"], ["blocked-normal-path", "unprotected-left-dense", "crossing-VRU"])
        self.assertEqual(config["attemptsPerCase"], 10)
        self.assertEqual(config["exit"], {"semanticYieldMin": 0.3, "casesMeetingYieldMin": 2,
                                          "reviewerFlipRateMax": 0.15, "maxOperationalFailures": 0,
                                          "reviewRepetitions": 3, "minimumGoldLabels": 12})
        for case in config["cases"]:
            self.assertIn(case["breadthCaseId"], breadth["caseIds"])

    def test_qualification_case_outside_the_breadth_set_fails_closed(self):
        breadth = qual.load_breadth(REPO / "apps/showcase/campaigns/breadth.json")
        config = json.loads((REPO / "apps/showcase/campaigns/qualification.json").read_text())
        config["cases"][2]["breadthCaseId"] = "not-a-real-case"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "qualification.json"
            path.write_text(json.dumps(config))
            with self.assertRaisesRegex(qual.QualificationError, "not in the breadth config"):
                qual.load_qualification(path, breadth)

    def test_committed_gold_manifest_matches_the_committed_bytes(self):
        manifest = qual.load_gold(REPO / "apps/showcase/campaigns/reviewer-gold.json", REPO)
        self.assertEqual(len(manifest["entries"]), 24)
        self.assertTrue(all(entry["video"]["file"].endswith("rollout.mp4") for entry in manifest["entries"]))


class ExitEvaluatorTest(unittest.TestCase):
    CALIBRATION = {"schema": qual.CALIBRATION_SCHEMA, "reviewVersion": qual.REVIEW_VERSION,
                   "goldSha256": "0" * 64, "repetitions": 3, "labelledEvidence": 12,
                   "flip": {"rate": 0.08, "byField": {}}, "realism": {"meanSd": 0.4}}

    def _config(self):
        breadth = qual.load_breadth(REPO / "apps/showcase/campaigns/breadth.json")
        return qual.load_qualification(REPO / "apps/showcase/campaigns/qualification.json", breadth)

    @staticmethod
    def _outcomes(accepted, attempts=10, operational=0):
        rows = []
        for number in range(1, attempts + 1):
            if number <= operational:
                rows.append(qual.attempt_outcome({"number": number, "status": "failed"}))
                continue
            realism = 8.0 if number <= operational + accepted else 3.0
            rows.append(qual.attempt_outcome(
                {"number": number, "status": "complete", "jobId": f"job-{number}"},
                {"cells": [{"status": "complete", "threeDReview": {
                    "version": qual.REVIEW_VERSION,
                    "mechanismFidelity": "yes" if number <= operational + accepted else "no",
                    "visualGrounding": "pass", "actorFidelity": "pass", "eventSequence": "pass",
                    "plausible": True, "realism": realism, "defects": []}}]}))
        return rows

    def test_operational_failures_are_not_semantic_verdicts(self):
        rows = self._outcomes(accepted=3, attempts=10, operational=2)
        summary = qual.summarize_case("blocked-normal-path", 10, rows)
        self.assertEqual(summary["operationalFailures"], 2)
        self.assertEqual(summary["countedAttempts"], 8)
        self.assertEqual(summary["semanticAccepted"], 3)
        self.assertEqual(summary["semanticYield"], 0.375)

    def test_unsupported_attempts_are_counted_as_representability(self):
        row = qual.attempt_outcome({"number": 1, "status": "complete",
                                    "unsupportedReason": "no reversible-lane primitive"})
        self.assertEqual(row["outcome"], "unsupported")
        self.assertEqual(row["decision"]["defectCodes"], ["unsupported"])

    def test_two_of_three_cases_at_thirty_percent_qualifies(self):
        config = self._config()
        verdict = qual.evaluate_exit(config, self.CALIBRATION, {
            "blocked-normal-path": self._outcomes(accepted=3),
            "unprotected-left-dense": self._outcomes(accepted=5),
            "crossing-VRU": self._outcomes(accepted=1),
        })
        self.assertTrue(verdict["qualified"])
        self.assertEqual(verdict["exitCode"], 0)
        self.assertEqual(verdict["blockers"], [])

    def test_one_case_at_yield_blocks_the_restart(self):
        config = self._config()
        verdict = qual.evaluate_exit(config, self.CALIBRATION, {
            "blocked-normal-path": self._outcomes(accepted=3),
            "unprotected-left-dense": self._outcomes(accepted=2),
            "crossing-VRU": self._outcomes(accepted=1),
        })
        self.assertFalse(verdict["qualified"])
        self.assertEqual(verdict["exitCode"], 2)
        self.assertEqual(verdict["blockers"], ["semantic-yield"])

    def test_flip_rate_and_operational_failures_block_independently(self):
        config = self._config()
        unstable = {**self.CALIBRATION, "flip": {"rate": 0.15, "byField": {}}}
        cases = {"blocked-normal-path": self._outcomes(accepted=5),
                 "unprotected-left-dense": self._outcomes(accepted=5),
                 "crossing-VRU": self._outcomes(accepted=5)}
        self.assertEqual(qual.evaluate_exit(config, unstable, cases)["blockers"], ["reviewer-flip"])
        degraded = dict(cases, **{"crossing-VRU": self._outcomes(accepted=5, operational=1)})
        self.assertEqual(qual.evaluate_exit(config, self.CALIBRATION, degraded)["blockers"],
                         ["operational-failures"])

    def test_insufficient_gold_labels_block_the_restart(self):
        config = self._config()
        thin = {**self.CALIBRATION, "labelledEvidence": 11}
        verdict = qual.evaluate_exit(config, thin, {
            "blocked-normal-path": self._outcomes(accepted=5),
            "unprotected-left-dense": self._outcomes(accepted=5),
            "crossing-VRU": self._outcomes(accepted=5),
        })
        self.assertEqual(verdict["blockers"], ["gold-labels"])

    def test_calibration_from_a_different_repetition_count_is_refused(self):
        config = self._config()
        with self.assertRaisesRegex(qual.QualificationError, "repetitions"):
            qual.evaluate_exit(config, {**self.CALIBRATION, "repetitions": 2},
                               {case: self._outcomes(accepted=5) for case in config["caseIds"]})

    def test_a_short_run_is_refused_rather_than_scored(self):
        config = self._config()
        with self.assertRaisesRegex(qual.QualificationError, "recorded 9 attempts"):
            qual.evaluate_exit(config, self.CALIBRATION, {
                "blocked-normal-path": self._outcomes(accepted=5, attempts=9),
                "unprotected-left-dense": self._outcomes(accepted=5),
                "crossing-VRU": self._outcomes(accepted=5),
            })


def _story(item):
    return gallery._story_key(item["meta"])


if __name__ == "__main__":
    unittest.main()
