import type { ITodoRepository } from "@kaipu/domain/repositories";
import type { UpdateTodo, TodoBase } from "@kaipu/domain/schemas";

export async function updateTodo(
  repository: ITodoRepository,
  id: string,
  userId: string,
  data: UpdateTodo,
): Promise<TodoBase | null> {
  return repository.update(id, userId, data);
}
