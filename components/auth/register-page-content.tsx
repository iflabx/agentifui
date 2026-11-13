'use client';

import { RegisterForm } from '@components/auth/register-form';
import { motion } from 'framer-motion';

export default function RegisterPageContent({
  phoneLoginEnabled,
}: {
  phoneLoginEnabled: boolean;
}) {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center bg-stone-100 px-4 py-12 font-serif sm:px-6 lg:px-8 dark:bg-stone-800">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md"
      >
        <RegisterForm phoneLoginEnabled={phoneLoginEnabled} />
      </motion.div>
    </main>
  );
}
