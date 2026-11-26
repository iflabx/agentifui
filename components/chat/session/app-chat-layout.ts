'use client';

import { createContext, useContext } from 'react';

export const AppChatLayout = createContext(false);

export function useAppChatLayout() {
  return useContext(AppChatLayout);
}
