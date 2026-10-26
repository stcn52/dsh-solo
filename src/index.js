/**
 * dsh-solo — the agent's operations, made visible, in the right sidebar.
 *
 * Not a to-do list and not a self-report: everything the panel shows is folded
 * from the session log's `tool/call` and `tool/result` events, so what you see
 * is what actually ran. The plugin imports nothing from `@deepseek-ai/*`: it
 * reaches `webServer` and `sessions` through cordis injection and Node built-ins,
 * so it loads from a profile without peer resolution.
 * @module dsh-solo
 */

import { registerRoutes } from './host/routes.js'

/** Cordis plugin name; also the settings namespace of the plugin row. */
export const name = 'solo'

/**
 * Mount the read-only HTTP surface.
 *
 * A headless profile simply never gets the panel; the host half still loads.
 * @param ctx - cordis context.
 */
export function apply(ctx) {
  const mounted = registerRoutes(ctx)
  if (!mounted && typeof ctx.logger?.warn === 'function') {
    ctx.logger.warn('dsh-solo: ctx.inject is unavailable; the panel has no data channel')
  }
}
