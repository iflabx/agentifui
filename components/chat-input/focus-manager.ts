import { create } from 'zustand';

interface FocusManagerState {
  inputRef: React.RefObject<HTMLTextAreaElement> | null;
  registerRef: (ref: React.RefObject<HTMLTextAreaElement>) => void;
  unregisterRef: () => void;
  focusInput: () => void;
}

export const useFocusManager = create<FocusManagerState>((set, get) => ({
  inputRef: null,
  registerRef: ref => {
    set({ inputRef: ref });
  },
  unregisterRef: () => set({ inputRef: null }),
  focusInput: () => {
    const { inputRef } = get();
    if (inputRef?.current) {
      inputRef.current.focus();
    }
  },
}));
