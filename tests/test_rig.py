from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from spromoji_rig.main import app

client = TestClient(app)

fixtures_dir = Path(__file__).parents[1] / "spromoji_rig" / "fixtures" / "avatars"


@pytest.mark.parametrize("avatar_file", sorted(fixtures_dir.glob("*.bin")))
def test_fixture_rigs(avatar_file):
    data = avatar_file.read_bytes()
    response = client.post("/rig", files={"file": (avatar_file.name, data, "application/octet-stream")})
    assert response.status_code == 200
    payload = response.json()
    assert "rig" in payload
    assert isinstance(payload["rig"], list)
    assert len(payload["rig"]) == 3
    for region in payload["rig"]:
        assert "poly" in region
        assert isinstance(region["poly"], list)
        assert len(region["poly"]) >= 4
