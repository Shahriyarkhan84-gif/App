import { IsString, Length } from 'class-validator';

export class CreateSupportTicketDto {
  @IsString()
  @Length(3, 120)
  subject!: string;

  @IsString()
  @Length(5, 4000)
  body!: string;
}
