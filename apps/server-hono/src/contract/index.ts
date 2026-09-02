import { oc } from "@orpc/contract";
import { recordingContract } from "./recording.contract";
import { todoContract } from "./todo.contract";

export const contract = oc.router({ todo: todoContract, recording: recordingContract });

export { recordingContract, todoContract };

export type Contract = typeof contract;
