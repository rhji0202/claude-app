import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { CreateUserDto, UpdateUserDto } from "./admin.dto";
import { AdminOnly } from "../auth/admin.decorator";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";

@AdminOnly()
@Controller("admin/users")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list() {
    return this.admin.list();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.admin.create(dto);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.update(id, dto, user.userId);
  }
}
