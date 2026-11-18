"""Adapters for hosted and localhost report-planning models."""

from contextlib import closing
from http.client import HTTPConnection, HTTPSConnection
import json
import os
import re

ENDPOINTS = {
    "gemini": ("generativelanguage.googleapis.com", "/v1beta/openai/chat/completions"),
    "claude": ("api.anthropic.com", "/v1/messages"),
    "grok": ("api.x.ai", "/v1/chat/completions"),
    "openai": ("api.openai.com", "/v1/chat/completions"),
}


class ProviderError(Exception):
    """A sanitized API diagnostic safe to show in the browser."""


def provider():
    selected = os.environ.get("RELATOVUE_AI_PROVIDER", "").lower()
    if selected in (*ENDPOINTS, "local") and os.environ.get("RELATOVUE_AI_MODEL"):
        if selected == "local" or os.environ.get("RELATOVUE_AI_KEY"):
            return selected
    return None


def get_plan(selected, instruction, context):
    model = os.environ["RELATOVUE_AI_MODEL"]
    key = os.environ.get("RELATOVUE_AI_KEY")
    headers = {"Content-Type": "application/json"}
    user_message = {"role": "user", "content": json.dumps(context, ensure_ascii=False)}
    if selected == "claude":
        headers.update({"x-api-key": key, "anthropic-version": "2023-06-01"})
        payload = {"model": model, "max_tokens": 1024, "system": instruction, "messages": [user_message]}
    else:
        if key:
            headers["Authorization"] = f"Bearer {key}"
        payload = {"model": model, "messages": [{"role": "system", "content": instruction}, user_message]}
    if selected == "local":
        port = int(os.environ.get("RELATOVUE_LOCAL_AI_PORT", "1234"))
        if not 1 <= port <= 65535:
            raise ValueError("Invalid local model port.")
        client = HTTPConnection("127.0.0.1", port, timeout=30)
        path = "/v1/chat/completions"
    else:
        host, path = ENDPOINTS[selected]
        client = HTTPSConnection(host, timeout=30)
    with closing(client):
        client.request("POST", path, json.dumps(payload), headers)
        response = client.getresponse()
        if response.status != 200:
            hints = {
                400: "Check that the model supports this chat API.",
                401: "Check that the API key is valid and belongs to the intended project.",
                403: "Check project permissions and model access.",
                404: "Check the exact API model ID and your project's access to it.",
                429: "Check API billing, quota, and rate limits.",
            }
            hint = hints.get(response.status, "Check provider availability and try again.")
            raise ProviderError(f"{selected} API returned HTTP {response.status}. {hint}")
        result = json.loads(response.read(262144))
    if selected == "claude":
        text = "".join(part["text"] for part in result["content"] if part.get("type") == "text")
    else:
        text = result["choices"][0]["message"]["content"]
    text = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text.strip(), flags=re.I)
    plan = json.loads(text)
    if not isinstance(plan, dict) or not isinstance(plan.get("action"), str):
        raise ValueError("Model did not return a report plan.")
    return plan
