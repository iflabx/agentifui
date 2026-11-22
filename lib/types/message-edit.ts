export type EditSubmissionResult =
  | boolean
  | {
      status: 'unknown';
      submissionId: string;
      check?: () => Promise<boolean | null>;
    };

export interface EditRecoveryReceipt {
  submissionId: string;
  accepted: boolean;
}
