import { describe, expect, it } from 'vitest';
import { groupSchema, invitationEmail } from './groups';

describe('Group identity and metadata', () => {
  it('requires an exact valid recipient email distinct from the sender', () => {
    expect(invitationEmail(' friend@gmail.com ', 'me@gmail.com')).toBe('friend@gmail.com');
    expect(() => invitationEmail('invalid', 'me@gmail.com')).toThrow('correo');
    expect(() => invitationEmail('ME@gmail.com', 'me@gmail.com')).toThrow('contigo');
  });
  it('rejects groups with more than two members or unknown states', () => {
    const group = {
      ownerUid: 'one',
      ownerEmail: 'one@gmail.com',
      invitedEmail: 'two@gmail.com',
      memberUids: ['one', 'two'],
      contributedUids: ['one'],
      status: 'active',
      activeRevision: 'revision',
    };
    expect(groupSchema.safeParse(group).success).toBe(true);
    expect(groupSchema.safeParse({ ...group, memberUids: ['one', 'two', 'three'] }).success).toBe(
      false,
    );
    expect(groupSchema.safeParse({ ...group, status: 'unknown' }).success).toBe(false);
  });
});
