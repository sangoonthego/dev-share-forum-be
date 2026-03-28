import {
    Controller,
    Get,
    Patch,
    Body,
    Param,
    UseGuards,
    Query,
    ParseIntPipe,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AtGuard } from '../common/guards/at.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { User } from '../common/decorators/user.decorator';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@Controller('users')
@UseGuards(AtGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get('me')
    @HttpCode(HttpStatus.OK)
    async getMe(@User('sub') userId: number) {
        const user = await this.usersService.findById(userId);
        if (!user) {
            return null;
        }
        const { password_hash, token_version, ...coreIdentity } = user;
        return coreIdentity;
    }

    @Get()
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @HttpCode(HttpStatus.OK)
    async findAll(@Query('page') page: string = '1', @Query('limit') limit: string = '10') {
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        return this.usersService.findAll(pageNum, limitNum);
    }

    @Patch(':id/status')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @HttpCode(HttpStatus.OK)
    async updateStatus(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateStatusDto: UpdateUserStatusDto,
    ) {
        return this.usersService.updateStatus(id, updateStatusDto);
    }
}