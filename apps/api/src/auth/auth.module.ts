import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';

/** Wires the three auth routes. `AuthController` consumes the global `AUTH_SERVICE` directly. */
@Module({
    controllers: [AuthController],
})
export class AuthModule {}
