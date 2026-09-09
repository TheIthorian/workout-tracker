import OpenAI from 'openai';
import { ConfigurationError } from '@app/errors';
import type { Logger } from '@app/logger';

/**
 * Configuration for an OpenAI-compatible chat model. `baseUrl` is deliberately not defaulted to
 * api.openai.com, so any OpenAI-compatible endpoint (OpenRouter, a local gateway) is honoured
 * as-is.
 */
export type LlmConfig = {
    apiKey: string;
    baseUrl: string;
    model: string;
};

/**
 * Dependencies for constructing an {@link LlmClient}: the connection configuration plus optional
 * collaborators, never read from the environment.
 */
export type LlmClientDeps = {
    config: LlmConfig;
    logger?: Logger;
    /** Custom fetch implementation. Tests inject a stub here instead of hitting the network. */
    fetch?: typeof fetch;
};

/**
 * A configured OpenAI-compatible client plus the collaborators needed to call it.
 *
 * An invalid `baseUrl` throws at construction rather than degrading silently: a misconfigured
 * client should never be handed to callers who then get empty results from every call.
 */
export class LlmClient {
    public readonly openai: OpenAI;
    public readonly model: string;
    public readonly logger?: Logger;

    /** Constructs an OpenAI-compatible client from injected configuration. */
    constructor({ config, logger, fetch: fetchImpl }: LlmClientDeps) {
        assertAbsoluteUrl(config.baseUrl);

        this.openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
            fetch: fetchImpl,
        });
        this.model = config.model;
        this.logger = logger;
    }
}

/**
 * A bad `baseUrl` is a misconfigured deployment, not a bad request from a caller: it is detected
 * at construction, from configuration the process booted with, before any request is ever made.
 * That is exactly {@link ConfigurationError}'s contract ("the environment a process booted with is
 * missing or contradictory"), not {@link RequestValidationError} or {@link InvalidFormatError} -
 * both of those describe a fault in caller-supplied request data, which this is not.
 */
function assertAbsoluteUrl(baseUrl: string): void {
    let parsed: URL;
    try {
        parsed = new URL(baseUrl);
    } catch {
        throw new ConfigurationError(`LlmConfig.baseUrl must be an absolute URL, got: ${baseUrl}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ConfigurationError(`LlmConfig.baseUrl must be an absolute URL, got: ${baseUrl}`);
    }
}
