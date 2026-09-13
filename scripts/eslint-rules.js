/**
 * GridVault Custom ESLint Security & Architecture Rules
 */

const sqlPattern =
  /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/i;

/**
 * Custom rule: Ban template-literal SQL interpolation
 */
export const noTemplateLiteralSqlRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban template-literal SQL string interpolation to enforce parameterized queries',
      category: 'Security',
      recommended: true
    },
    schema: []
  },
  create(context) {
    return {
      TemplateLiteral(node) {
        if (!node.expressions || node.expressions.length === 0) {
          return;
        }

        const isSqlText = node.quasis.some((q) => sqlPattern.test(q.value.raw));
        if (isSqlText) {
          context.report({
            node,
            message:
              'Template literal SQL with expressions is forbidden. Use parameterized SQL queries with bound parameters instead.'
          });
        }
      },
      TaggedTemplateExpression(node) {
        if (
          node.tag &&
          node.tag.name &&
          node.tag.name.toLowerCase() === 'sql' &&
          node.quasi.expressions.length > 0
        ) {
          context.report({
            node,
            message:
              'Template literal SQL with expressions is forbidden. Use parameterized SQL queries with bound parameters instead.'
          });
        }
      }
    };
  }
};

/**
 * Custom rule: Ban direct repository imports from src/http/routes/
 */
export const noRepositoryImportsInRoutesRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban direct repository imports in HTTP route handlers to enforce service encapsulation',
      category: 'Architecture',
      recommended: true
    },
    schema: []
  },
  create(context) {
    const filename = context.filename || (context.getFilename && context.getFilename()) || '';
    const isRouteHandler =
      filename.includes('/src/http/routes/') || filename.includes('\\src\\http\\routes\\');

    if (!isRouteHandler) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        const importSource = node.source.value;
        if (
          typeof importSource === 'string' &&
          (importSource.includes('/repositories') || importSource.endsWith('/repositories'))
        ) {
          context.report({
            node,
            message:
              'Direct repository imports from route handlers are forbidden. Route handlers must call service functions.'
          });
        }
      }
    };
  }
};
