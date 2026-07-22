import { SetMetadata } from "@nestjs/common";

export const ADMIN_ONLY_KEY = "adminOnly";

/** 이 라우트(또는 컨트롤러)는 전역 admin만 접근 가능. */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);
