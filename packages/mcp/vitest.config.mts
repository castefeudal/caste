export default {
  test: {
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://caste:caste@localhost:5432/caste_test",
    },
  },
};
