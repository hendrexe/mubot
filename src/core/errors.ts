/**
 * An error whose message is safe to show to the end user. Throw it from commands or services;
 * the interaction handler turns it into an ephemeral reply. Anything else is logged and the user
 * only sees a generic message.
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
