import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import os
import json

path = Path(__file__).parent.parent / "services/scripts/local-triage.py"
spec = importlib.util.spec_from_file_location("local_triage", path)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class Agent:
    def __init__(self, usage):
        self.usage = usage

    def predict(self, state, questions):
        return {"answers": {"fit": {"type": "choice", "choice": "unknown", "probabilities": {"yes": .2, "unknown": .8}}}, "usage": self.usage}


class LocalWorkerTest(unittest.TestCase):
    request = {"state": "Synthetic task", "questions": {"fit": {"type": "choice", "instructions": "Select the supported answer.", "criteria": {"yes": "Fits", "unknown": "Unknown"}}}}

    def setUp(self):
        # These unit cases own post-inference usage handling. The native
        # tokenizer cases below exercise the preflight without loading weights.
        fit = patch.object(worker, "complete_questions_fit", return_value=True)
        fit.start()
        self.addCleanup(fit.stop)

    def test_retains_actual_usage_and_unknown_answer(self):
        result = worker.predict(Agent({"truncated": False, "state_tokens_dropped": 0, "input_tokens": 51, "output_tokens": 0}), self.request)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["inputTokens"], 51)
        self.assertEqual(result["answers"]["fit"]["choice"], "unknown")

    def test_abstains_on_truncated_or_missing_fit_evidence(self):
        for usage in [{}, {"truncated": True}, {"truncated": False, "state_tokens_dropped": 4}]:
            self.assertEqual(worker.predict(Agent(usage), self.request), {"status": "abstained", "reason": "local_context_truncated"})

    def test_abstains_when_options_collapsed(self):
        result = worker.predict(Agent({"truncated": False, "options": {"fit": {"total": 3, "distinct": 2}}}), self.request)
        self.assertEqual(result, {"status": "abstained", "reason": "local_options_collapsed"})

    def test_rejects_eleven_choices_with_unqualified_checkpoint_calibration(self):
        request = {"state": "Synthetic", "questions": {"fit": {"type": "choice", "criteria": {str(n): str(n) for n in range(11)}}}}
        self.assertEqual(worker.predict(None, request), {"status": "abstained", "reason": "local_input_invalid"})

    def test_rejects_unbounded_or_non_choice_question_sets(self):
        for request in [{}, {"state": "x", "questions": {}}, {"state": "x", "questions": {"fit": {"type": "score", "criteria": ["a", "b"]}}}]:
            self.assertEqual(worker.predict(None, request), {"status": "abstained", "reason": "local_input_invalid"})


class NativeQuestionFitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import laya
            from laya.agent import Agent as LayaAgent
            from laya.common import build_head
            from transformers import AutoTokenizer
        except ImportError as error:
            raise unittest.SkipTest("Native tokenizer checks require the pinned offline Laya Python environment") from error
        if laya.__version__ != worker.PIN["sdkVersion"]:
            raise AssertionError("Native tokenizer tests require the pinned SDK version")
        default = Path(__file__).resolve().parents[4] / ".runtime/laya/models" / ("convaiinnovations-laya-" + worker.PIN["revision"]) / worker.PIN["checkpoint"]
        directory = Path(os.environ.get("PAPERCLIP_LAYA_CHECKPOINT", str(default)))
        if not (directory / "tokenizer/tokenizer.json").is_file():
            raise unittest.SkipTest("Set PAPERCLIP_LAYA_CHECKPOINT to the installed pinned checkpoint; tests never download it")
        cls.tokenizer = AutoTokenizer.from_pretrained(str(directory / "tokenizer"), local_files_only=True)
        cls.config = json.loads((directory / "rl_agent_config.json").read_text())
        cls.agent_type = LayaAgent
        cls.build_head = staticmethod(build_head)

    def setUp(self):
        # No constructor/load/inference: only the installed tokenizer and native
        # question projection are real. Any attempted inference is observable.
        self.agent = self.agent_type.__new__(self.agent_type)
        self.agent.tok = self.tokenizer
        self.agent.cfg = dict(self.config)
        self.agent.predict = Mock(return_value={"answers": {}, "usage": {"truncated": False, "state_tokens_dropped": 0, "input_tokens": 7, "output_tokens": 0}})

    def request(self, instructions="Choose the supported option.", criteria=None, **extra):
        return {"state": "Synthetic", "questions": {"fit": {"type": "choice", "instructions": instructions,
                "criteria": criteria or {"yes": "Supported", "unknown": "Unknown"}, **extra}}}

    def assert_preflight_abstains(self, request):
        self.assertEqual(worker.predict(self.agent, request), {"status": "abstained", "reason": "local_context_truncated"})
        self.agent.predict.assert_not_called()

    def test_complete_question_reaches_inference_once(self):
        self.assertEqual(worker.predict(self.agent, self.request())["status"], "succeeded")
        self.agent.predict.assert_called_once()

    def test_distinct_options_clipped_at_48_tokens_never_reach_inference(self):
        request = self.request(criteria={"first": "long description " * 60, "second": "different description " * 60})
        _, _, stats = self.build_head(self.tokenizer, self.agent._to_internal(request["questions"]["fit"]), self.agent.cfg.get("head_max_len", 192))
        self.assertEqual(stats["options_distinct"], 2)
        self.assertIsNone(stats["tokens_per_option"])
        self.assert_preflight_abstains(request)

    def test_unique_labels_cannot_hide_head_budget_option_clipping(self):
        criteria = {f"candidate_{index}": "quality " * 32 for index in range(9)}
        criteria["unknown"] = "No supported candidate"
        request = self.request(criteria=criteria)
        _, _, stats = self.build_head(self.tokenizer, self.agent._to_internal(request["questions"]["fit"]), self.agent.cfg.get("head_max_len", 192))
        self.assertEqual(stats["options_distinct"], 10)
        self.assertIsNotNone(stats["tokens_per_option"])
        self.assert_preflight_abstains(request)

    def test_clipped_instructions_never_reach_inference(self):
        self.assert_preflight_abstains(self.request(instructions="Follow all of this mandatory instruction. " * 100))

    def test_sequence_limit_cannot_drop_the_complete_question(self):
        self.agent.cfg["max_len"] = 8
        self.assert_preflight_abstains(self.request())

    def test_sdk_structured_unicode_rendering_and_option_order_are_preserved(self):
        request = self.request(instructions={"rule": "Choisissez seulement une réponse étayée."},
                               criteria={"oui": {"meaning": "démontré"}, "unknown": "incertain"}, option_order=[1, 0])
        self.assertEqual(worker.predict(self.agent, request)["status"], "succeeded")
        self.agent.predict.assert_called_once_with(request["state"], request["questions"])


if __name__ == "__main__":
    unittest.main()
