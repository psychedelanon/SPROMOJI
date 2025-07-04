from pathlib import Path
import importlib.util

import pytest
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location(
    "spromoji_rig.main", Path(__file__).parents[1] / "spromoji-rig" / "main.py"
)
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)

client = TestClient(main.app)

fixtures_dir = Path(main.__file__).parent / "fixtures" / "avatars"


@pytest.mark.parametrize("avatar_file", sorted(fixtures_dir.glob("*.bin")))
def test_fixture_rigs(avatar_file):
    data = avatar_file.read_bytes()
    response = client.post("/rig", files={"file": (avatar_file.name, data, "application/octet-stream")})
    assert response.status_code == 200
    payload = response.json()
    assert "rig" in payload
    assert isinstance(payload["rig"], list)
    assert len(payload["rig"]) == 3
    # ensure polygons are lists of points
    for region in payload["rig"]:
        assert "poly" in region
        assert isinstance(region["poly"], list)
        assert len(region["poly"]) >= 4
