import { StudioError } from "../errors";

/**
 * An AI service couldn't answer right now: its free limit is used up, it is busy, or it can't be
 * reached. The studio then tries the next model in line instead of failing the step.
 */
export class AiUnavailableError extends StudioError {
  constructor(
    message: string,
    readonly reason: "limit" | "offline" | "busy",
  ) {
    super(message);
  }
}
