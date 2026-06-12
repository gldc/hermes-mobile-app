// Shared "Switch profile" action sheet — used by the sidebar and the
// add-to-chat sheet. iOS-first (ActionSheetIOS) with an Alert fallback.
import { ActionSheetIOS, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { getProfileState, setSelectedProfile } from '@/profile-store';

const isIOS = process.env.EXPO_OS === 'ios';

export function showProfilePicker(): void {
  const { names, selected, serverCurrent } = getProfileState();
  const current = selected ?? serverCurrent;
  const labels = names.map((n) => (n === current ? `${n} ✓` : n));
  const pick = (index: number) => {
    if (index < 0 || index >= names.length || names[index] === current) return;
    if (isIOS) Haptics.selectionAsync();
    void setSelectedProfile(names[index]);
  };
  if (isIOS) {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Switch profile', options: [...labels, 'Cancel'], cancelButtonIndex: names.length },
      (index) => pick(index === names.length ? -1 : index),
    );
  } else {
    Alert.alert('Switch profile', undefined, [
      ...names.map((n, i) => ({ text: labels[i], onPress: () => pick(i) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }
}
