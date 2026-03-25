import { create } from 'zustand';

interface FocusManagerState {
  inputRef: React.RefObject<HTMLTextAreaElement> | null;
  registerRef: (ref: React.RefObject<HTMLTextAreaElement>) => void;
  focusInput: () => void;
}

export const useFocusManager = create<FocusManagerState>((set, get) => ({
  inputRef: null,
  registerRef: ref => {
    set({ inputRef: ref });
  },
  focusInput: () => {
    const { inputRef } = get();
    if (inputRef?.current) {
      inputRef.current.focus();
    }
  },
}));
