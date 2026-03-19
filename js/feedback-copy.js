const WHAT_HAPPENED_BY_TYPE = {
  bug: {
    label: 'What happened?',
    placeholder: 'Describe the bug, what you expected to happen, or steps to reproduce.',
  },
  idea: {
    label: "What's your idea?",
    placeholder: 'Describe your idea or suggestion.',
  },
  feedback: {
    label: 'What feedback would you like to share?',
    placeholder: "Let us know what you liked or how we can improve.",
  },
};

/**
 * Returns the label/placeholder copy for the main feedback textarea.
 * Kept as a pure function so it can be sanity-tested in Node.
 */
export function getWhatHappenedCopy(type) {
  return WHAT_HAPPENED_BY_TYPE[type] ?? WHAT_HAPPENED_BY_TYPE.bug;
}

