console.log("Test");

//let message: string = "Testing TypeScript debugger";
let count =  0;

function greet(){
    count++;
    return `Hello world!`;
}

const result = greet();
console.log(result);


const numbers = [1, 2, 3, 4, 5];


for (let i = 0; i < 3; i++) {
    console.log(`Loop iteration: ${i}`);
}

console.log("final output: test")
