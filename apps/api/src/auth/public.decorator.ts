import { SetMetadata } from "@nestjs/common";

/** 이 데코레이터가 붙은 라우트는 전역 JWT 가드를 우회한다. */
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
