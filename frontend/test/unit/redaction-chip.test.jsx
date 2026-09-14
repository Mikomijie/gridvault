// AT-624: RedactionChip renders reason_code text from _meta — no role logic.
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import RedactionChip from '../../src/components/RedactionChip.jsx';

describe('AT-624: RedactionChip renders reason_code text from _meta', () => {
  it('shows the server-supplied reason text for a known code', () => {
    render(<RedactionChip redaction={{ field: 'hiv_status', group: 'SENSITIVE', reason_code: 'CLERK_NO_CLINICAL' }} />);
    expect(screen.getByLabelText('Restricted to clinical staff')).toBeDefined();
  });

  it('falls back to the raw code for an unknown reason, still with no role logic', () => {
    render(<RedactionChip redaction={{ field: 'x', group: 'SENSITIVE', reason_code: 'FUTURE_CODE' }} />);
    expect(screen.getByLabelText('Restricted: FUTURE_CODE')).toBeDefined();
  });

  it('never renders a value, only the reason', () => {
    const { container } = render(
      <RedactionChip redaction={{ field: 'hiv_status', group: 'SENSITIVE', reason_code: 'WARD_MISMATCH', value: 'Reactive (Confirmed)' }} />
    );
    expect(container.textContent).not.toContain('Reactive (Confirmed)');
    expect(container.textContent).toContain('Outside your assigned ward');
  });
});
