// The phone apps' haptic engine, behind lib/haptic. Loaded on the phone only. A phone with no
// engine, or a refused call, just stays still: nothing here can fail the action it accompanies.
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import type { Haptic } from "@/lib/haptic";

const still = () => {};

export function fireHaptic(kind: Haptic): void {
  if (kind === "success") {
    Haptics.notification({ type: NotificationType.Success }).catch(still);
  } else if (kind === "light") {
    Haptics.impact({ style: ImpactStyle.Light }).catch(still);
  } else {
    // The three steps of the system's selection feedback, each after the one before.
    Haptics.selectionStart()
      .then(() => Haptics.selectionChanged())
      .then(() => Haptics.selectionEnd())
      .catch(still);
  }
}
