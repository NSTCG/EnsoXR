import * as babel from '@babel/types';

type CollectibleNode = babel.DoWhileStatement | babel.ForInStatement | babel.ForOfStatement | babel.ForStatement | babel.IfStatement | babel.WhileStatement;

export type { CollectibleNode };
