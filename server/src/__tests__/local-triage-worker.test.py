import importlib.util
from pathlib import Path
import unittest

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
    request = {"state": "Synthetic task", "questions": {"fit": {"type": "choice", "criteria": {"yes": "Fits", "unknown": "Unknown"}}}}

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


if __name__ == "__main__":
    unittest.main()
