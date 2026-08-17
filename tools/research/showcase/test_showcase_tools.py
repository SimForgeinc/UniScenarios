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
