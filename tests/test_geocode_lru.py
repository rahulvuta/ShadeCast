"""Geocode in-memory cache is LRU-capped."""

from api.routes import geocode as geocode_route


def test_geocode_cache_evicts_oldest_beyond_256():
    geocode_route._CACHE.clear()
    for i in range(geocode_route._CACHE_MAX + 5):
        geocode_route.cache_set(f"q-{i}", (0.0, [{"id": i}]))
    assert len(geocode_route._CACHE) == geocode_route._CACHE_MAX
    assert "q-0" not in geocode_route._CACHE
    assert "q-5" in geocode_route._CACHE
    geocode_route._CACHE.clear()
