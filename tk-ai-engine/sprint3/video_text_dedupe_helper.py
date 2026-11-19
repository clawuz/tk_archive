"""Small helper for experiment_combined_frame_call.py — reuses the same
near-duplicate dedup logic as sprint2/video_text.py's extract_video_supers,
but takes an already-extracted list of texts (or None entries) instead of
calling read_frame_text() itself, since the combined-call experiment gets
on_screen_text as a side effect of the tagging call, not a separate call.
"""


def _similar(a, b):
    a, b = a.lower(), b.lower()
    return a == b or a in b or b in a


def dedupe_texts(texts):
    distinct = []
    for text in texts:
        if not text:
            continue
        if distinct and _similar(distinct[-1], text):
            if len(text) > len(distinct[-1]):
                distinct[-1] = text
            continue
        distinct.append(text)
    return distinct
