"""Error types. Every failure an author can cause should raise LiveryError with a
message that says which spec key is wrong and what would be valid."""


class LiveryError(Exception):
    """A problem with user-authored input (spec, profile, art metadata)."""


class ProfileError(LiveryError):
    """The car profile is missing or does not describe what the spec asks for."""


class ArtError(LiveryError):
    """A logo / source-art file or its sidecar metadata is unusable."""
