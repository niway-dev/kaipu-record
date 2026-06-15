import type { ITodoRepository } from "@kaipu/domain/repositories";
import type { TodoBase } from "@kaipu/domain/schemas";

export async function getTodo(
  repository: ITodoRepository,
  id: string,
  userId: string,
): Promise<TodoBase | null> {
  return repository.findById(id, userId);
}
