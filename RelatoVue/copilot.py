"""Server-side Copilot Studio Direct Line transport."""

from contextlib import closing
from http.client import HTTPSConnection
import json
import os
import re
from time import monotonic, sleep
from urllib.parse import urlencode
from uuid import uuid4

HOSTS = {
    "global": "directline.botframework.com",
    "europe": "europe.directline.botframework.com",
    "india": "india.directline.botframework.com",
}
BASE = "/v3/directline"


def enabled():
    return bool(os.environ.get("RELATOVUE_COPILOT_SECRET"))


def get_plan(instruction, context):
    secret = os.environ["RELATOVUE_COPILOT_SECRET"]
    host = HOSTS[os.environ.get("RELATOVUE_COPILOT_REGION", "global")]
    deadline = monotonic() + 25

    def request(method, path, body=None, token=secret):
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise TimeoutError("Copilot did not return a report plan.")
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        with closing(HTTPSConnection(host, timeout=min(8, remaining))) as connection:
            connection.request(method, path, None if body is None else json.dumps(body), headers)
            response = connection.getresponse()
            if not 200 <= response.status < 300:
                raise OSError("Copilot request failed.")
            return json.loads(response.read(262144))

    user = "dl_" + uuid4().hex
    conversation = request("POST", BASE + "/conversations", {"user": {"id": user}})
    conversation_id = conversation["conversationId"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", conversation_id):
        raise ValueError("Unexpected conversation identifier.")
    token = conversation["token"]
    path = BASE + "/conversations/" + conversation_id + "/activities"
    request("POST", path, {
        "type": "message", "from": {"id": user}, "textFormat": "plain",
        "text": instruction + "\n" + json.dumps(context, ensure_ascii=False),
    }, token)
    watermark = None
    while monotonic() < deadline:
        page = request("GET", path + ("?" + urlencode({"watermark": watermark}) if watermark else ""), token=token)
        watermark = page.get("watermark") or watermark
        for activity in page.get("activities", []):
            if activity.get("type") != "message" or activity.get("from", {}).get("id") == user:
                continue
            text = activity.get("text")
            if not isinstance(text, str):
                continue
            text = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text.strip(), flags=re.I)
            try:
                plan = json.loads(text)
            except ValueError:
                continue
            if isinstance(plan, dict) and isinstance(plan.get("action"), str):
                return plan
        sleep(0.5)
    raise TimeoutError("Copilot did not return a report plan.")
