from __future__ import annotations

import numpy as np


def solve_intercept_time(
    interceptor_origin: np.ndarray,
    interceptor_speed: float,
    target_pos: np.ndarray,
    target_vel: np.ndarray,
) -> float | None:
    rel = target_pos - interceptor_origin
    a = np.dot(target_vel, target_vel) - interceptor_speed**2
    b = 2.0 * np.dot(rel, target_vel)
    c = np.dot(rel, rel)

    if abs(a) < 1e-8:
        if abs(b) < 1e-8:
            return None
        t = -c / b
        return t if t > 0 else None

    roots = np.roots([a, b, c])
    real_roots = [root.real for root in roots if abs(root.imag) < 1e-6 and root.real > 0]
    return min(real_roots) if real_roots else None

