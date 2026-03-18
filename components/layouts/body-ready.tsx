'use client';

import { useEffect } from 'react';

export function BodyReady() {
  useEffect(() => {
    document.body.classList.add('render-ready');

    return () => {
      document.body.classList.remove('render-ready');
    };
  }, []);

  return null;
}
