import { TABLE_PREFIX } from "../config";
import { pgTableCreator } from "drizzle-orm/pg-core";

export const createTable = pgTableCreator((name) => `${TABLE_PREFIX}_${name}`);
