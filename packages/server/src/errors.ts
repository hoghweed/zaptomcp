abstract class ZapToMCPError extends Error {
    public constructor(message?: string) {
        super(message);
        this.name = new.target.name;
    }
}

export class UnexpectedStateError extends ZapToMCPError {
    public extras?: Extras;
  
    public constructor(message: string, extras?: Extras) {
      super(message);
      this.name = new.target.name;
      this.extras = extras;
    }
  }

  /**
 * An error that is meant to be surfaced to the user.
 */
export class UserError extends UnexpectedStateError {}