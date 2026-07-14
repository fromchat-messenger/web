import { useEffect, useState } from "react";

export interface WindowSize {
    width: number;
    height: number;
}

export default function useWindowSize(): WindowSize {
    const [width, setWidth] = useState(innerWidth);
    const [height, setHeight] = useState(innerHeight);

    useEffect(() => {
        function listener() {
            setWidth(innerWidth);
            setHeight(innerHeight);
        }

        addEventListener("resize", listener);

        return () => {
            removeEventListener("resize", listener);
        }
    });

    return {
        width: width,
        height: height
    }
}