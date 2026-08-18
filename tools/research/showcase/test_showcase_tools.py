#!/usr/bin/env python3
"""Focused unit tests for P5 glue; no gateway, simulator, or renderer calls."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


HERE = Path(__file__).resolve().parent


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


def _story(item):
    return gallery._story_key(item["meta"])


if __name__ == "__main__":
    unittest.main()
