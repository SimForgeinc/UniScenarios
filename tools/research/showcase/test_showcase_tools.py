#!/usr/bin/env python3
"""Focused unit tests for P5 glue; no gateway, simulator, or renderer calls."""
import importlib.util
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


class GallerySelectionTest(unittest.TestCase):
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
