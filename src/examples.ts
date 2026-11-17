export interface Example {
  id: string;
  title: string;
  blurb: string;
  code: string;
}

/** Six tiny starters. The last one is deliberately broken, to try Fix all errors on. */
export const EXAMPLES: Example[] = [
  {
    id: 'hello',
    title: 'Hello, world',
    blurb: 'Print your first message',
    code: `# Hello, world!
print("Hello, world!")
print("Welcome to PyPal.")
`,
  },
  {
    id: 'variables',
    title: 'Variables',
    blurb: 'Store values and use them',
    code: `# Variables store values so you can use them later.
name = "Ada"
age = 12
height = 1.52

print("Name:", name)
print("Next year", name, "will be", age + 1)
print("Height in cm:", height * 100)
`,
  },
  {
    id: 'loops',
    title: 'Loops',
    blurb: 'Repeat things with for and while',
    code: `# Loops repeat things.
for i in range(1, 6):
    print("Count:", i)

total = 0
n = 1
while n <= 5:
    total = total + n
    n = n + 1
print("The sum of 1 to 5 is", total)
`,
  },
  {
    id: 'functions',
    title: 'Functions',
    blurb: 'Package up steps you can reuse',
    code: `# A function packages up steps you can reuse.
def greet(name):
    return "Hello, " + name + "!"


def square(n):
    return n * n


print(greet("Ada"))
print("5 squared is", square(5))
`,
  },
  {
    id: 'input',
    title: 'Asking questions',
    blurb: 'Use input() to talk to the user',
    code: `# input() asks the person using the program a question.
name = input("What is your name? ")
age = int(input("How old are you? "))

print("Nice to meet you,", name + "!")
print("In 10 years you will be", age + 10)
`,
  },
  {
    id: 'broken',
    title: 'Broken program',
    blurb: 'Try Fix all errors on it',
    code: `# This program has a few mistakes. Click "Fix all errors" to fix them!
def greet(name)
    print("Hello, " + name + "!")

greet("Ada")

age = input("How old are you? ")
if age > 12:
    print("You are a teenager or older.")
else:
    print("You are a kid.")

total = 0
for i in range(1, 4):
    total = total + i
pritn("The total is", total)
`,
  },
];

export const exampleById = (id: string) => EXAMPLES.find((e) => e.id === id);
