"""Measure delays between keystrokes. Type freely, press ESC to see results."""
import time
import statistics
from pynput import keyboard

times = []
keys = []

def key_label(key):
    if hasattr(key, 'char') and key.char is not None:
        return key.char
    return str(key).replace('Key.', '')

def on_press(key):
    if key == keyboard.Key.esc:
        return False
    times.append(time.perf_counter())
    keys.append(key_label(key))

print("Start typing... press ESC when done.")
with keyboard.Listener(on_press=on_press) as listener:
    listener.join()

if len(times) < 2:
    print("Not enough keystrokes recorded.")
else:
    delays_ms = [(times[i] - times[i - 1]) * 1000 for i in range(1, len(times))]
    print("\nKey  Delay to next (ms)")
    for k, d in zip(keys[:-1], delays_ms):
        print(f"{k}  {d:.1f}")
    print(f"{keys[-1]}")
    print(f"\nAverage delay: {sum(delays_ms) / len(delays_ms):.1f} ms")
    print(f"Median delay:  {statistics.median(delays_ms):.1f} ms")
    print(f"Min delay:     {min(delays_ms):.1f} ms")
