import type { ITodoRepository } from "@kaipu/domain/repositories";
import type { CreateTodo, TodoBase } from "@kaipu/domain/schemas";

export async function createTodo(
  repository: ITodoRepository,
  data: CreateTodo,
  userId: string,
): Promise<TodoBase> {
  return repository.create({ ...data, userId });
}
